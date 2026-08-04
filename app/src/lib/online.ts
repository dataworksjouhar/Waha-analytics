/* Types and aggregation for the online channel section (architecture doc
 * metrics 5 and 6).
 *
 * Both metrics compare the booking website against the physical tills, and
 * both have a grain problem underneath them that the honest version of the
 * chart has to deal with rather than paper over. They are different
 * problems, so they are handled in different places:
 *
 *   metric 5  the website sells one ticket per venue while the till sells
 *             adult, child and family, so the two channels are only
 *             comparable once SKUs are rolled up to venue and category.
 *   metric 6  the headline view averages two years into one rate per
 *             channel, which cannot show a channel getting worse. The
 *             monthly view added in session 7 can.
 */

import type { DateRange } from "./months";

/** One row of gold.vw_ticket_channel_mix (one per product SKU).
 *
 *  `online_share_pct` is present but deliberately not what this section
 *  displays. At SKU grain it is an artifact of the crosswalk in
 *  pipeline/load/fact_bookings.py, which pins every online ticket onto the
 *  adult SKU because the website checkout never recorded which variant a
 *  customer picked. Read straight, it says child tickets are a product
 *  nobody buys online (they are not on the website at all) and adult
 *  tickets are 60% online (they are not; they are carrying the child and
 *  family sales too). The rollup below is where the honest figure lives. */
export interface TicketChannelMix {
  product_key: number;
  product_code: string;
  product_name: string;
  category: string;
  online_qty: number;
  online_amount_kwd: number;
  walk_in_qty: number;
  walk_in_amount_kwd: number;
  online_share_pct: number | null;
  venue_key: number | null;
  venue_name: string;
}

/** One row of gold.vw_web_channel_conversion (one per channel, whole
 *  history). */
export interface ChannelConversion {
  channel_key: number | null;
  channel_name: string;
  sessions: number | null;
  engaged_sessions: number | null;
  users: number | null;
  booking_count: number;
  booking_amount_kwd: number;
  conversion_rate_pct: number | null;
}

/** One row of gold.vw_web_channel_conversion_monthly.
 *
 *  `month_start` is null on the attribution-loss rows: they come from
 *  bookings with no channel, which never match a sessions row, and
 *  month_start is taken from the sessions side. `month_key` is the join
 *  key that is always present. */
export interface ChannelConversionMonth {
  month_key: number;
  month_start: string | null;
  channel_key: number | null;
  channel_name: string;
  sessions: number | null;
  engaged_sessions: number | null;
  users: number | null;
  booking_count: number;
  booking_amount_kwd: number;
  conversion_rate_pct: number | null;
}

// ---------------------------------------------------------------------
// Metric 5: online vs walk-in
// ---------------------------------------------------------------------

export interface ChannelMixGroup {
  key: string;
  venue_name: string;
  category: string;
  onlineQty: number;
  walkInQty: number;
  totalQty: number;
  onlineAmount: number;
  walkInAmount: number;
  onlineSharePct: number | null;
  /** the SKUs folded into this group, for the table underneath */
  products: TicketChannelMix[];
  /** true when the website sells fewer SKUs than the till does in this
   *  group, which is the condition that makes a per-SKU share misleading
   *  and is worth saying out loud next to the number */
  crosswalked: boolean;
}

/** Rolls SKUs up to the grain where online and walk-in are comparable:
 *  venue plus category.
 *
 *  Both parts are needed. Venue alone would put the Farm's entry tickets
 *  and its kiosk snacks in one bucket, and the kiosk genuinely has no
 *  online channel, so mixing them would drag the Farm's online share down
 *  for a reason that has nothing to do with how people buy tickets.
 *  Category alone would merge the Playground and the Farm.
 *
 *  Grouping keys come off dim_product rather than a hardcoded list of Al
 *  Waha's products, so a client with a different SKU tree needs no code
 *  change here. */
export function groupChannelMix(rows: TicketChannelMix[]): ChannelMixGroup[] {
  const groups = new Map<string, ChannelMixGroup>();

  for (const row of rows) {
    const key = `${row.venue_name}|${row.category}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        venue_name: row.venue_name,
        category: row.category,
        onlineQty: 0,
        walkInQty: 0,
        totalQty: 0,
        onlineAmount: 0,
        walkInAmount: 0,
        onlineSharePct: null,
        products: [],
        crosswalked: false,
      };
      groups.set(key, group);
    }
    group.onlineQty += row.online_qty;
    group.walkInQty += row.walk_in_qty;
    group.onlineAmount += row.online_amount_kwd;
    group.walkInAmount += row.walk_in_amount_kwd;
    group.products.push(row);
  }

  return [...groups.values()]
    .map((group) => {
      const totalQty = group.onlineQty + group.walkInQty;
      const sellingOnline = group.products.filter((p) => p.online_qty > 0).length;
      const sellingWalkIn = group.products.filter((p) => p.walk_in_qty > 0).length;
      return {
        ...group,
        totalQty,
        onlineSharePct: totalQty > 0 ? (group.onlineQty / totalQty) * 100 : null,
        // More till SKUs than website SKUs means the website's single
        // product is standing in for several, which is exactly when the
        // per-SKU share stops meaning anything.
        crosswalked: sellingOnline > 0 && sellingWalkIn > sellingOnline,
      };
    })
    .sort((a, b) => b.totalQty - a.totalQty);
}

// ---------------------------------------------------------------------
// Metric 6: channel conversion over time
// ---------------------------------------------------------------------

/** Channels get a fixed colour slot by name, assigned once here.
 *
 *  Never by rank and never by array position: filtering to three channels
 *  must not repaint the survivors, or a reader who has learned "orange is
 *  paid social" learns it wrong the moment the filter changes. A channel
 *  not in this map falls through to a neutral slot rather than being
 *  handed a generated hue. */
const CHANNEL_SLOT: Record<string, string> = {
  organic: "3",
  paid_social: "2",
  direct: "1",
  referral: "7",
};

export const channelSlot = (channelName: string): string => CHANNEL_SLOT[channelName] ?? "8";

export interface ChannelPoint {
  month_key: number;
  month_start: string | null;
  sessions: number | null;
  bookings: number;
  conversionPct: number | null;
  /** true where the month has too few sessions for a rate to mean much,
   *  which at this site is the partial month at the end of the history */
  thin: boolean;
}

export interface ChannelSeries {
  channel_name: string;
  slot: string;
  points: ChannelPoint[];
  totalSessions: number;
  totalBookings: number;
  /** conversion over the whole selected range, computed from the totals
   *  rather than by averaging the monthly rates. Those differ: a mean of
   *  ratios weights a quiet August the same as a busy January. */
  overallPct: number | null;
  /** mean rate of the first and last quarter of the range, and the change
   *  between them. This is the trend reduced to one number for a tile;
   *  the chart is still where the shape is read. */
  firstPct: number | null;
  lastPct: number | null;
  changePct: number | null;
}

/** A month carrying fewer sessions than this is drawn but not trusted for
 *  a rate. The history ends on the first of a month, so the final bucket
 *  holds a single day and a couple of hundred sessions against months of
 *  four to six thousand. Dropping it would be hiding data; letting it set
 *  the shape of a trend line would be worse. */
const THIN_MONTH_SESSIONS = 1000;

/** How many months at each end feed the "first vs last" comparison. Three
 *  rather than one so a single odd month cannot define the trend. */
const TREND_WINDOW = 3;

const meanOf = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;

/** One series per channel, ordered by session volume.
 *
 *  Channels with no sessions at all are dropped from the chart: the
 *  attribution-loss bucket is bookings whose channel was lost, so it has
 *  a booking count and no denominator. A conversion line for it would be
 *  meaningless. It is reported separately as a share of bookings that
 *  cannot be attributed, which is the honest way to show it. */
export function channelSeries(
  rows: ChannelConversionMonth[],
  range: DateRange | null,
): ChannelSeries[] {
  const inRange = rows.filter((row) => {
    if (range === null) return true;
    // Compared on month_key rather than month_start, which is null on the
    // attribution-loss rows. The ribbon selects whole months, so the
    // month's own key is enough to place it.
    const key = Number(`${range.start.slice(0, 4)}${range.start.slice(5, 7)}`);
    const end = Number(`${range.end.slice(0, 4)}${range.end.slice(5, 7)}`);
    return row.month_key >= key && row.month_key <= end;
  });

  const byChannel = new Map<string, ChannelConversionMonth[]>();
  for (const row of inRange) {
    const list = byChannel.get(row.channel_name) ?? [];
    list.push(row);
    byChannel.set(row.channel_name, list);
  }

  const series: ChannelSeries[] = [];

  for (const [channel_name, months] of byChannel) {
    const totalSessions = months.reduce((s, m) => s + (m.sessions ?? 0), 0);
    if (totalSessions === 0) continue;

    const points = months
      .sort((a, b) => a.month_key - b.month_key)
      .map((m) => ({
        month_key: m.month_key,
        month_start: m.month_start,
        sessions: m.sessions,
        bookings: m.booking_count,
        conversionPct: m.conversion_rate_pct,
        thin: (m.sessions ?? 0) < THIN_MONTH_SESSIONS,
      }));

    // Thin months are excluded from the trend arithmetic but stay on the
    // chart, drawn as a broken segment, so nothing is hidden.
    const solid = points.filter((p) => !p.thin && p.conversionPct !== null);
    const firstPct = meanOf(solid.slice(0, TREND_WINDOW).map((p) => p.conversionPct as number));
    const lastPct = meanOf(solid.slice(-TREND_WINDOW).map((p) => p.conversionPct as number));
    const totalBookings = months.reduce((s, m) => s + m.booking_count, 0);

    series.push({
      channel_name,
      slot: channelSlot(channel_name),
      points,
      totalSessions,
      totalBookings,
      overallPct: totalSessions > 0 ? (totalBookings / totalSessions) * 100 : null,
      firstPct,
      lastPct,
      changePct:
        firstPct !== null && lastPct !== null && firstPct !== 0
          ? ((lastPct - firstPct) / firstPct) * 100
          : null,
    });
  }

  return series.sort((a, b) => b.totalSessions - a.totalSessions);
}

/** How far a channel's conversion has to fall before the section calls it
 *  out. A third is well beyond drift or a seasonal wobble, and at this
 *  site the gap is stark: the flagged channel loses roughly two thirds
 *  while every other channel gains. */
const DECAY_THRESHOLD_PCT = -33;

export const isDecaying = (series: ChannelSeries) =>
  series.changePct !== null && series.changePct <= DECAY_THRESHOLD_PCT;

/** Bookings that arrived with no channel attached, as a share of all
 *  bookings. Reported rather than buried: "we cannot say where this
 *  revenue came from" is a finding about the tracking setup, and a
 *  dashboard that silently drops those rows makes every channel above
 *  look more complete than it is. */
export function attributionLoss(rows: ChannelConversion[]): {
  bookings: number;
  amount: number;
  sharePct: number | null;
} {
  let lost = 0;
  let lostAmount = 0;
  let total = 0;
  for (const row of rows) {
    total += row.booking_count;
    if (row.channel_key === null || row.sessions === null || row.sessions === 0) {
      lost += row.booking_count;
      lostAmount += row.booking_amount_kwd;
    }
  }
  return { bookings: lost, amount: lostAmount, sharePct: total > 0 ? (lost / total) * 100 : null };
}
