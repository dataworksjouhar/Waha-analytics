/* Types and aggregation for the footfall and own-venue sales section
 * (architecture doc metrics 1, 2, 7 and 10).
 *
 * Every shape here mirrors a view in sql/01_footfall_and_sales.sql one for
 * one. Where a field is nullable in TypeScript it is nullable in the view
 * for a reason, and the reason is always the same: an absent figure and a
 * zero are different facts, and the pipeline goes to some trouble not to
 * confuse them. The frontend must not undo that by defaulting nulls to 0
 * on the way to a chart.
 */

import { isWithin, type DateRange } from "./months";
import type { FootfallDay } from "./data";

/** One row of gold.vw_footfall_sales_conversion (date x venue).
 *
 *  Two denominators, deliberately. `footfall` is site-wide, the honest
 *  headline: one Main Gate entry may reach the tenant strip, the Farm and
 *  the gym on a single visit, so no entry truly "belongs" to a venue.
 *  `entrance_footfall` is the narrower count through the entrance this
 *  venue's visitors actually use. It is a better figure for the Equestrian
 *  Centre, which has its own gate, and a worse one for the three venues
 *  that share the Main Gate and therefore share a denominator. Both are
 *  carried so the reader can see the difference rather than be handed one
 *  of them as if it were the truth. */
export interface VenueConversion {
  date_key: number;
  full_date: string;
  venue_id: string;
  venue_name: string;
  venue_type: string;
  footfall: number;
  revenue_kwd: number;
  line_count: number;
  revenue_per_visitor_kwd: number | null;
  conversion_rate: number | null;
  zone: string | null;
  gate_proximity: string | null;
  entrance_footfall: number | null;
  revenue_per_entrance_visitor_kwd: number | null;
  entrance_conversion_rate: number | null;
}

/** One row of gold.vw_event_roi. The uplift fields are null for an event
 *  the view could not measure: EVT016 carries an end_date before its
 *  start_date (the planted DQ catch), so it matches no calendar days and
 *  has no event total to compare a baseline against. It is kept in the
 *  data and shown on screen as unmeasurable rather than filtered out. */
export interface EventRoi {
  event_key: number;
  event_id: string;
  event_name: string;
  event_type: string | null;
  start_date: string;
  end_date: string | null;
  expected_attendance: number | null;
  event_day_count: number | null;
  total_footfall: number | null;
  total_sales_kwd: number | null;
  baseline_avg_footfall: number | null;
  baseline_avg_sales_kwd: number | null;
  footfall_uplift_per_day: number | null;
  sales_uplift_per_day_kwd: number | null;
}

/** One row of gold.vw_avg_transaction_value (one per venue). */
export interface VenueAtv {
  venue_key: number;
  venue_id: string;
  venue_name: string;
  venue_type: string;
  sale_invoice_count: number;
  refund_invoice_count: number;
  avg_transaction_value_kwd: number | null;
  net_revenue_kwd: number;
}

/** One row of gold.vw_footfall_by_zone (date x zone). */
export interface ZoneFootfall {
  date_key: number;
  full_date: string;
  season: string;
  is_weekend: boolean;
  is_ramadan: boolean;
  zone: string;
  gate_label: string;
  primary_venue_served: string | null;
  footfall: number;
  has_imputed_hours: boolean;
  has_corrected_hours: boolean;
}

// ---------------------------------------------------------------------
// Metric 1: daily footfall
// ---------------------------------------------------------------------

export interface FootfallSummary {
  days: number;
  total: number;
  meanPerDay: number;
  busiest: FootfallDay | null;
  /** total over the same days a year earlier, null where the range
   *  reaches back before the data starts and no comparison exists */
  totalYearAgo: number | null;
  yearOnYearPct: number | null;
  flaggedDays: number;
  dustStormDays: number;
}

export function summariseFootfall(days: FootfallDay[]): FootfallSummary {
  if (days.length === 0) {
    return {
      days: 0, total: 0, meanPerDay: 0, busiest: null,
      totalYearAgo: null, yearOnYearPct: null, flaggedDays: 0, dustStormDays: 0,
    };
  }

  let total = 0;
  let busiest = days[0];
  let flaggedDays = 0;
  let dustStormDays = 0;

  // Year-ago is summed only over the days that HAVE a year-ago figure, and
  // the current-period total for that same subset is summed alongside it.
  // Comparing a full 12-month range against a year-ago total covering only
  // part of it would report a collapse that is really just the start of
  // the dataset.
  let comparableNow = 0;
  let comparableThen = 0;
  let comparableDays = 0;

  for (const day of days) {
    total += day.footfall;
    if (day.footfall > busiest.footfall) busiest = day;
    if (day.has_imputed_hours || day.has_corrected_hours) flaggedDays += 1;
    if (day.dust_storm_flag) dustStormDays += 1;
    if (day.footfall_year_ago !== null) {
      comparableNow += day.footfall;
      comparableThen += day.footfall_year_ago;
      comparableDays += 1;
    }
  }

  return {
    days: days.length,
    total,
    meanPerDay: total / days.length,
    busiest,
    totalYearAgo: comparableDays > 0 ? comparableThen : null,
    yearOnYearPct:
      comparableDays > 0 && comparableThen > 0
        ? ((comparableNow - comparableThen) / comparableThen) * 100
        : null,
    flaggedDays,
    dustStormDays,
  };
}

// ---------------------------------------------------------------------
// Metric 2: footfall to sales conversion
// ---------------------------------------------------------------------

export interface VenueConversionSummary {
  venue_id: string;
  venue_name: string;
  zone: string | null;
  gate_proximity: string | null;
  revenue_kwd: number;
  /** revenue divided by SITE-WIDE footfall over the same days */
  revenuePerSiteVisitor: number | null;
  /** revenue divided by the venue's own entrance footfall */
  revenuePerEntranceVisitor: number | null;
}

/** Rolls the daily venue rows up to one row per venue for the selected
 *  range.
 *
 *  The ratio is recomputed from summed revenue over summed footfall, not
 *  averaged from the daily ratios. Averaging a ratio weights a quiet
 *  Tuesday the same as a packed Friday and gives a number that matches no
 *  actual period. Sum the numerator, sum the denominator, divide once. */
export function summariseVenueConversion(rows: VenueConversion[]): VenueConversionSummary[] {
  const byVenue = new Map<
    string,
    {
      venue_name: string;
      zone: string | null;
      gate_proximity: string | null;
      revenue: number;
      siteFootfall: number;
      entranceFootfall: number;
      entranceDays: number;
    }
  >();

  for (const row of rows) {
    let bucket = byVenue.get(row.venue_id);
    if (!bucket) {
      bucket = {
        venue_name: row.venue_name,
        zone: row.zone,
        gate_proximity: row.gate_proximity,
        revenue: 0,
        siteFootfall: 0,
        entranceFootfall: 0,
        entranceDays: 0,
      };
      byVenue.set(row.venue_id, bucket);
    }
    bucket.revenue += row.revenue_kwd;
    bucket.siteFootfall += row.footfall;
    if (row.entrance_footfall !== null) {
      bucket.entranceFootfall += row.entrance_footfall;
      bucket.entranceDays += 1;
    }
  }

  return [...byVenue.entries()]
    .map(([venue_id, b]) => ({
      venue_id,
      venue_name: b.venue_name,
      zone: b.zone,
      gate_proximity: b.gate_proximity,
      revenue_kwd: b.revenue,
      revenuePerSiteVisitor: b.siteFootfall > 0 ? b.revenue / b.siteFootfall : null,
      revenuePerEntranceVisitor:
        b.entranceDays > 0 && b.entranceFootfall > 0 ? b.revenue / b.entranceFootfall : null,
    }))
    .sort((a, b) => b.revenue_kwd - a.revenue_kwd);
}

// ---------------------------------------------------------------------
// Metric 7: event ROI
// ---------------------------------------------------------------------

/** Events that overlap the selected range, most recent first, with the
 *  unmeasurable ones kept and pushed to the end. An event is in range if
 *  any part of its window is, so a bazaar straddling a month boundary
 *  appears when either month is selected. */
export function eventsInRange(events: EventRoi[], range: DateRange | null): EventRoi[] {
  const overlapping = events.filter((event) => {
    if (range === null) return true;
    const end = event.end_date ?? event.start_date;
    // Compared as ISO strings, which sort chronologically, so no Date
    // parsing and no timezone can move an event across midnight.
    const [from, to] = event.start_date <= end ? [event.start_date, end] : [end, event.start_date];
    return from <= range.end && to >= range.start;
  });

  return overlapping.sort((a, b) => {
    const aMeasured = a.footfall_uplift_per_day !== null;
    const bMeasured = b.footfall_uplift_per_day !== null;
    if (aMeasured !== bMeasured) return aMeasured ? -1 : 1;
    if (!aMeasured) return a.start_date.localeCompare(b.start_date);
    return (b.footfall_uplift_per_day as number) - (a.footfall_uplift_per_day as number);
  });
}

/** An event that pulled a crowd in and still sold less than an ordinary
 *  day: extra visitors, less money. This is the case the GM most wants
 *  flagged, and it is invisible in a footfall-only view, which is exactly
 *  why metric 7 compares both against the same baseline. */
export const isCrowdedButUnprofitable = (event: EventRoi) =>
  event.footfall_uplift_per_day !== null &&
  event.sales_uplift_per_day_kwd !== null &&
  event.footfall_uplift_per_day > 0 &&
  event.sales_uplift_per_day_kwd < 0;

// ---------------------------------------------------------------------
// Range filtering
// ---------------------------------------------------------------------

export const filterByDate = <T extends { full_date: string }>(rows: T[], range: DateRange | null) =>
  range === null ? rows : rows.filter((row) => isWithin(row.full_date, range));
