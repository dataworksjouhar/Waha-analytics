/* Phase 2 session 5: footfall and own-venue sales.
 *
 * Four of the twelve locked metrics live here, in the order a GM would
 * actually ask them: how many people came (1), what they were worth to
 * each venue (2), whether the events paid for themselves (7), and what a
 * single transaction is worth (10).
 *
 * Every chart is scoped by the one season filter above the section, not
 * by controls of its own, so the whole screen always describes the same
 * slice of time. The one exception is metric 10, whose gold view is a
 * whole-history aggregate with no date column; that card says so rather
 * than sitting there looking filtered.
 */

import { useMemo } from "react";
import type { FootfallDay } from "../lib/data";
import { formatCurrency, formatNumber, formatPercent } from "../lib/format";
import type { DateRange } from "../lib/months";
import {
  eventsInRange,
  filterByDate,
  isCrowdedButUnprofitable,
  summariseFootfall,
  summariseVenueConversion,
  type EventRoi,
  type VenueAtv,
  type VenueConversion,
  type ZoneFootfall,
} from "../lib/footfall";
import { AtvChart } from "./charts/AtvChart";
import { EventRoiChart } from "./charts/EventRoiChart";
import { FootfallTimeline } from "./charts/FootfallTimeline";
import { VenueConversionChart } from "./charts/VenueConversionChart";

export function FootfallSales({
  days,
  conversion,
  events,
  atv,
  zones,
  range,
  currency,
}: {
  days: FootfallDay[];
  conversion: VenueConversion[];
  events: EventRoi[];
  atv: VenueAtv[];
  zones: ZoneFootfall[];
  range: DateRange | null;
  currency: string;
}) {
  const scoped = useMemo(
    () => ({
      days: filterByDate(days, range),
      conversion: filterByDate(conversion, range),
      zones: filterByDate(zones, range),
      events: eventsInRange(events, range),
    }),
    [days, conversion, zones, events, range],
  );

  const summary = useMemo(() => summariseFootfall(scoped.days), [scoped.days]);
  const venues = useMemo(
    () => summariseVenueConversion(scoped.conversion),
    [scoped.conversion],
  );

  const byEntrance = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of scoped.zones) {
      totals.set(row.gate_label, (totals.get(row.gate_label) ?? 0) + row.footfall);
    }
    const grand = [...totals.values()].reduce((a, b) => a + b, 0);
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, share: grand > 0 ? (value / grand) * 100 : 0 }));
  }, [scoped.zones]);

  const ownRevenue = venues.reduce((total, venue) => total + venue.revenue_kwd, 0);
  const flaggedEvents = scoped.events.filter(isCrowdedButUnprofitable);

  // Rounded before the sign is chosen, so a change of -0.04% prints as
  // "0.0%" and not as "-0%" with a down arrow. A figure that rounds to
  // nothing is flat, and dressing it as a decline because the raw number
  // happens to sit a hair below zero would be a false signal on the tile
  // a reader looks at first.
  const yoy =
    summary.yearOnYearPct === null ? null : Math.round(summary.yearOnYearPct * 10) / 10;
  const yoyDirection = yoy === null || yoy === 0 ? undefined : yoy > 0 ? "up" : "down";

  return (
    <>
      <section className="card">
        <h2 className="card__title">Footfall</h2>
        <p className="card__note">
          Metric 1. Daily visitors against the same day a year earlier, with maximum temperature
          on its own axis below. Counted at the gates, so this is entries to the site, not to any
          one venue.
        </p>

        <div className="tiles">
          <div className="tile tile--hero">
            <span className="tile__label">Visitors in range</span>
            <span className="tile__value tile__value--hero">{formatNumber(summary.total)}</span>
            <span className="tile__meta">
              {formatNumber(summary.days)} days, {formatNumber(summary.meanPerDay)} a day
            </span>
          </div>
          <div className="tile">
            <span className="tile__label">Versus a year earlier</span>
            <span className="tile__value" data-direction={yoyDirection}>
              {yoy === null ? "-" : `${yoy > 0 ? "+" : ""}${formatPercent(yoy)}`}
            </span>
            <span className="tile__meta">
              {summary.totalYearAgo === null
                ? "no comparable year-ago days in range"
                : "over the days with a year-ago figure"}
            </span>
          </div>
          <div className="tile">
            <span className="tile__label">Busiest day</span>
            <span className="tile__value">
              {summary.busiest ? formatNumber(summary.busiest.footfall) : "-"}
            </span>
            <span className="tile__meta">{summary.busiest?.full_date ?? "-"}</span>
          </div>
          <div className="tile">
            <span className="tile__label">Days carrying a data flag</span>
            <span className="tile__value">{formatNumber(summary.flaggedDays)}</span>
            <span className="tile__meta">
              imputed or outlier-corrected hours, never hidden
            </span>
          </div>
        </div>

        <FootfallTimeline days={scoped.days} />

        {byEntrance.length > 0 ? (
          <p className="chart__note">
            By entrance:{" "}
            {byEntrance
              .map((e) => `${e.label} ${formatNumber(e.value)} (${formatPercent(e.share, 0)})`)
              .join(", ")}
            . The counter vendor reports four physical sensors; these are the two entrances they
            roll up to.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2 className="card__title">Footfall to sales</h2>
        <p className="card__note">
          Metric 2. What each own-operated venue earned per visitor, on both available
          denominators. Own-venue revenue in range: {formatCurrency(ownRevenue, currency)}.
        </p>
        <VenueConversionChart venues={venues} currency={currency} />
      </section>

      <section className="card">
        <h2 className="card__title">Event ROI</h2>
        <p className="card__note">
          Metric 7. Visitors and sales during each event against the 14 days before it.
          {flaggedEvents.length > 0
            ? ` ${formatNumber(flaggedEvents.length)} event${flaggedEvents.length === 1 ? "" : "s"} in this range drew a crowd and still sold less than a normal day.`
            : ""}
        </p>
        <EventRoiChart events={scoped.events} currency={currency} />

        {flaggedEvents.map((event) => (
          <div className="finding" key={event.event_id}>
            <h3 className="finding__title">
              {event.event_name} filled the park and emptied the tills
            </h3>
            <p className="finding__body">
              It drew {formatNumber(event.footfall_uplift_per_day)} more visitors a day than the
              fortnight before it, and own-venue sales came in{" "}
              {formatCurrency(Math.abs(event.sales_uplift_per_day_kwd as number), currency)} a day{" "}
              <strong>lower</strong> than a normal day. More people, less money, which is the one
              combination a footfall-only report can never show: on visitor numbers alone this was
              among the best days of the season.
            </p>
            <p className="finding__body">
              The likely mechanism is worth testing rather than asserting: an event with its own
              free entertainment pulls a crowd that came for the event and not to spend, and it
              displaces the regular paying visitor who avoids the queues. Either way the question
              for the next one is not whether it was busy. It is what the gate cost, what the
              programming cost, and whether{" "}
              {formatNumber(event.footfall_uplift_per_day)} extra bodies a day are worth having if
              they buy less than the people they crowded out.
            </p>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="card__title">Average transaction value</h2>
        <p className="card__note">
          Metric 10. Average value of a genuine purchase invoice, refunds counted separately
          rather than averaged in. Whole history: this view has no date column, so the season
          filter above does not apply to it.
        </p>
        <AtvChart venues={atv} currency={currency} />
      </section>
    </>
  );
}
