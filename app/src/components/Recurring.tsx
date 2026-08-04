/* Phase 2 session 8: recurring revenue and the equestrian centre.
 *
 * Metrics 8, 9, 11 and 12. Four metrics in one section because they are
 * one argument: this business has a transactional half that collapses
 * every Kuwaiti summer and a contractual half that does not, and the
 * second is what keeps the lights on in August.
 *
 * The warehouse decision underneath is worth stating plainly, because it
 * is the most interviewable thing in the whole project. Gym memberships,
 * equestrian club memberships and horse boarding are one periodic
 * snapshot fact, not three tables. A gym and a livery stable look like
 * different businesses and are the same shape: a member, a month, an
 * amount, a status that can churn. Metrics 8, 9 and 12 are then three
 * readings of one fact rather than three integrations.
 */

import { useMemo } from "react";
import { formatCurrency, formatNumber, formatPercent } from "../lib/format";
import { isPartialMonth, type DateRange, type MonthCell } from "../lib/months";
import {
  capacitySqueeze,
  inRangeByMonth,
  levelSeries,
  membershipSeries,
  partialMonthSet,
  prettyContract,
  type InstructorCoverage,
  type LessonMonth,
  type MembershipMonth,
  type RevenueMonth,
  type StableMonth,
} from "../lib/recurring";
import { MembershipChart } from "./charts/MembershipChart";
import { OccupancyChart } from "./charts/OccupancyChart";
import { RevenueMixChart } from "./charts/RevenueMixChart";
import { UtilizationChart } from "./charts/UtilizationChart";

export function Recurring({
  membership,
  revenue,
  lessons,
  instructors,
  stables,
  months,
  range,
  currency,
}: {
  membership: MembershipMonth[];
  revenue: RevenueMonth[];
  lessons: LessonMonth[];
  instructors: InstructorCoverage[];
  stables: StableMonth[];
  months: MonthCell[];
  range: DateRange | null;
  currency: string;
}) {
  const partial = useMemo(() => partialMonthSet(months, isPartialMonth), [months]);
  const series = useMemo(() => membershipSeries(membership, range), [membership, range]);
  const revenueMonths = useMemo(() => inRangeByMonth(revenue, range), [revenue, range]);
  const levels = useMemo(() => levelSeries(lessons, range), [lessons, range]);
  const stableMonths = useMemo(() => inRangeByMonth(stables, range), [stables, range]);

  const squeeze = useMemo(() => capacitySqueeze(levels), [levels]);
  const idleInstructors = instructors.filter((i) => i.lesson_count === 0);

  const totalMrr = series.reduce((total, s) => total + (s.latestMrr ?? 0), 0);
  const totalActive = series.reduce((total, s) => total + s.latestActive, 0);

  /* Recurring share is computed on whole months only. A partial month has
   * a full membership snapshot against a fraction of the till, so
   * including it would inflate exactly the number this tile reports. */
  const wholeMonths = revenueMonths.filter((m) => !partial.has(m.month_start));
  const recurringShare = useMemo(() => {
    const total = wholeMonths.reduce((sum, m) => sum + m.total_revenue_kwd, 0);
    const mrr = wholeMonths.reduce((sum, m) => sum + (m.membership_mrr_kwd ?? 0), 0);
    return total > 0 ? (mrr / total) * 100 : null;
  }, [wholeMonths]);

  /* The summer argument, stated as a number rather than asserted: the
   * weakest and strongest months of own-venue trade, and what the
   * contractual streams were doing in the same months. */
  const seasonSpread = useMemo(() => {
    if (wholeMonths.length < 2) return null;
    const worst = wholeMonths.reduce((a, b) =>
      a.own_venue_revenue_kwd <= b.own_venue_revenue_kwd ? a : b,
    );
    const best = wholeMonths.reduce((a, b) =>
      a.own_venue_revenue_kwd >= b.own_venue_revenue_kwd ? a : b,
    );
    if (worst.month_start === best.month_start) return null;
    return { worst, best };
  }, [wholeMonths]);

  const latestStable = stableMonths[stableMonths.length - 1] ?? null;

  return (
    <>
      <section className="card">
        <h2 className="card__title">Revenue mix</h2>
        <p className="card__note">
          Metric 9. The three income streams by month: own-venue tills, tenant rent, and the
          recurring base of memberships and boarding. They never overlap, so the total is a real
          figure and not a double count.
        </p>

        <div className="tiles">
          <div className="tile tile--hero">
            <span className="tile__label">Recurring share of revenue</span>
            <span className="tile__value tile__value--hero">
              {formatPercent(recurringShare)}
            </span>
            <span className="tile__meta">
              memberships and boarding, over {formatNumber(wholeMonths.length)} whole months
            </span>
          </div>
          <div className="tile">
            <span className="tile__label">Monthly recurring revenue</span>
            <span className="tile__value">{formatCurrency(totalMrr, currency)}</span>
            <span className="tile__meta">
              {formatNumber(totalActive)} active contracts at the latest month
            </span>
          </div>
          {seasonSpread ? (
            <div className="tile">
              <span className="tile__label">Own-venue swing</span>
              <span className="tile__value" data-direction="down">
                {formatPercent(
                  (1 -
                    seasonSpread.worst.own_venue_revenue_kwd /
                      seasonSpread.best.own_venue_revenue_kwd) *
                    100,
                  0,
                )}
              </span>
              <span className="tile__meta">
                peak month to trough month, against{" "}
                {formatPercent(
                  Math.abs(
                    1 -
                      (seasonSpread.worst.membership_mrr_kwd ?? 0) /
                        (seasonSpread.best.membership_mrr_kwd || 1),
                  ) * 100,
                  0,
                )}{" "}
                for the recurring base
              </span>
            </div>
          ) : null}
        </div>

        <RevenueMixChart months={revenueMonths} partialMonths={partial} currency={currency} />

        <p className="chart__note">
          This is the shape the whole business plan rests on. Outdoor trade in Kuwait is not a
          gentle curve, it is a cliff, and the contractual streams are what carry the payroll
          through the months when nobody wants to be outside. That is also the argument for the
          equestrian centre keeping an air-conditioned arena and a livery yard rather than only a
          riding school.
        </p>
      </section>

      <section className="card">
        <h2 className="card__title">Membership base and churn</h2>
        <p className="card__note">
          Metric 8. Active contracts by type, from one periodic-snapshot fact covering gym
          memberships, equestrian club memberships and horse boarding together.
        </p>

        <div className="tiles">
          {series.map((s) => (
            <div className="tile" key={s.contract_type}>
              <span className="tile__label">{prettyContract(s.contract_type)}</span>
              <span className="tile__value">{formatNumber(s.latestActive)}</span>
              <span className="tile__meta">
                {formatPercent(s.churnPct, 1)} monthly churn,{" "}
                {s.netChange > 0 ? "+" : ""}
                {formatNumber(s.netChange)} over the range
              </span>
            </div>
          ))}
        </div>

        <MembershipChart series={series} currency={currency} />
      </section>

      <section className="card">
        <h2 className="card__title">Riding lesson utilization</h2>
        <p className="card__note">
          Metric 11. Seats booked as a share of seats offered, by level and month. A lesson slot
          has a fixed number of places and a paid instructor standing in front of it, so what
          matters is not how many lessons ran but how full they were.
        </p>

        <div className="tiles">
          {levels.map((level) => (
            <div className="tile" key={level.level}>
              <span className="tile__label">{level.level}</span>
              <span className="tile__value">{formatPercent(level.overallPct, 0)}</span>
              <span className="tile__meta">
                best month {formatPercent(level.peakPct, 0)}, no-show{" "}
                {formatPercent(level.noShowPct, 0)}
              </span>
            </div>
          ))}
        </div>

        <UtilizationChart levels={levels} />

        {squeeze ? (
          <div className="finding">
            <h3 className="finding__title">
              The school is turning {squeeze.full.level}s away and teaching{" "}
              {squeeze.empty.level} to half-empty rooms
            </h3>
            <p className="finding__body">
              In the months when {squeeze.full.level} lessons hit{" "}
              {formatPercent(squeeze.fullPeak, 0)} of capacity, {squeeze.empty.level} lessons ran
              at {formatPercent(squeeze.emptyAtFullPeak, 0)}. Those are the same months, so this
              is not one level having a better season than the other: the weather, the school
              holidays and the travel are identical for both. Over the whole range{" "}
              {squeeze.full.level} sits at {formatPercent(squeeze.full.overallPct, 0)} against{" "}
              {formatPercent(squeeze.empty.overallPct, 0)}, and the gap holds in every month of
              the two years rather than opening and closing with the season.
            </p>
            <p className="finding__body">
              A slot that cannot take another booking is lost revenue with an instructor already
              paid for, and{" "}
              {formatNumber(squeeze.full.overbookedCount)} {squeeze.full.level} slots were booked
              past their capacity rather than turning the booking away, which is the same demand
              showing up as a data quality flag. Moving arena hours from {squeeze.empty.level} to{" "}
              {squeeze.full.level} costs nothing but the timetable. The instructors are the
              constraint on doing it, which is the next paragraph.
            </p>
          </div>
        ) : null}

        {/* The confound, stated before anyone draws the wrong conclusion
            from the chart above. This is why there is no instructor
            league table in this dashboard. */}
        <p className="chart__note chart__note--caveat">
          Utilization is shown by level and not by instructor, even though the gold view carries
          both. Here each level is taught by exactly one instructor, so the two columns are
          perfectly confounded: a per-instructor chart would be the same three numbers wearing
          people's names, and it would imply the data can tell an underperforming coach from a
          level with less demand. It cannot.{" "}
          {idleInstructors.length > 0 ? (
            <>
              Related, and worth a question rather than a conclusion:{" "}
              {idleInstructors.map((i) => i.instructor_name).join(", ")}{" "}
              {idleInstructors.length === 1 ? "is" : "are"} on the roster as active
              {idleInstructors[0].specialty_level
                ? ` (${idleInstructors[0].specialty_level.replace(/_/g, " ")})`
                : ""}{" "}
              but appear{idleInstructors.length === 1 ? "s" : ""} against no lessons at all in two
              years. Either the schedule never rostered{" "}
              {idleInstructors.length === 1 ? "them" : "them"}, or the export is missing their
              slots. The utilization view alone could never show this, because an instructor with
              no lessons has no row in it.
            </>
          ) : null}
        </p>
      </section>

      <section className="card">
        <h2 className="card__title">Stable occupancy</h2>
        <p className="card__note">
          Metric 12. Boxes under an active boarding contract against the yard's fixed inventory.
          The one denominator in this dashboard that is genuinely immovable: you cannot board a
          twenty-first horse in twenty boxes.
        </p>

        {latestStable ? (
          <div className="tiles">
            <div className="tile tile--hero">
              <span className="tile__label">Occupancy</span>
              <span className="tile__value tile__value--hero">
                {formatPercent(latestStable.occupancy_pct, 0)}
              </span>
              <span className="tile__meta">
                {formatNumber(latestStable.occupied_boxes)} of{" "}
                {formatNumber(latestStable.total_boxes)} boxes at the latest month
              </span>
            </div>
            <div className="tile">
              <span className="tile__label">Boarding revenue</span>
              <span className="tile__value">
                {formatCurrency(latestStable.boarding_revenue_kwd, currency)}
              </span>
              <span className="tile__meta">per month, effectively flat year round</span>
            </div>
            <div className="tile">
              <span className="tile__label">Empty boxes</span>
              <span className="tile__value">
                {formatNumber(latestStable.total_boxes - latestStable.occupied_boxes)}
              </span>
              <span className="tile__meta">
                worth{" "}
                {formatCurrency(
                  latestStable.occupied_boxes > 0
                    ? ((latestStable.boarding_revenue_kwd ?? 0) / latestStable.occupied_boxes) *
                        (latestStable.total_boxes - latestStable.occupied_boxes)
                    : null,
                  currency,
                )}{" "}
                a month at the current rate
              </span>
            </div>
          </div>
        ) : null}

        <OccupancyChart months={stableMonths} currency={currency} />
      </section>
    </>
  );
}
