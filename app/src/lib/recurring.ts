/* Types and aggregation for the recurring revenue and equestrian section
 * (architecture doc metrics 8, 9, 11 and 12).
 *
 * The structural idea this section demonstrates is in the warehouse, not
 * here: gym memberships, equestrian club memberships and horse boarding
 * are one periodic-snapshot fact, not three tables, because they are the
 * same shape. A member, a month, an amount, and a status that can churn.
 * Recognising that a riding stable and a gym are the same business
 * problem is the modelling judgement, and this section is where it pays
 * off, since one fact answers metrics 8, 9 and 12 between them.
 */

import type { DateRange, MonthCell } from "./months";

/** One row of gold.vw_membership_active_churn (month x contract type).
 *
 *  `churn_rate_pct` is null in the first month of the history: it is
 *  churned-this-month over active-last-month, and there is no last month
 *  to divide by. Null rather than zero, because "no previous month" and
 *  "nobody left" are different facts. */
export interface MembershipMonth {
  month_date_key: number;
  month_start: string;
  contract_type: string;
  active_count: number;
  new_count: number;
  churned_count: number;
  active_mrr_kwd: number | null;
  churn_rate_pct: number | null;
}

/** One row of gold.vw_revenue_summary (one per month).
 *
 *  The three streams never overlap, so summing them is not double
 *  counting: memberships and boarding are contracts in
 *  fact_membership_months and never appear as invoice lines in
 *  fact_pos_sales. That is asserted in the view and worth being able to
 *  defend, because "are you sure you are not counting the gym twice" is
 *  the first question anyone sensible asks of a revenue mix chart. */
export interface RevenueMonth {
  month_date_key: number;
  month_start: string;
  own_venue_revenue_kwd: number;
  rental_revenue_kwd: number | null;
  membership_mrr_kwd: number | null;
  total_revenue_kwd: number;
}

/** One row of gold.vw_lesson_utilization_monthly. */
export interface LessonMonth {
  month_key: number;
  month_start: string;
  level: string;
  instructor_key: number | null;
  instructor_name: string | null;
  lesson_count: number;
  total_capacity: number;
  total_booked: number;
  total_attended: number | null;
  missing_attendance_count: number;
  overbooked_count: number;
  utilization_pct: number | null;
  no_show_rate_pct: number | null;
}

/** One row of gold.vw_instructor_coverage. */
export interface InstructorCoverage {
  instructor_key: number;
  instructor_id: string;
  instructor_name: string;
  specialty_level: string | null;
  status: string;
  hire_date: string | null;
  lesson_count: number;
  total_capacity: number;
  total_booked: number;
}

/** One row of gold.vw_stable_occupancy (one per month). */
export interface StableMonth {
  month_date_key: number;
  month_start: string;
  occupied_boxes: number;
  total_boxes: number;
  occupancy_pct: number | null;
  boarding_revenue_kwd: number | null;
}

// ---------------------------------------------------------------------
// Partial months
// ---------------------------------------------------------------------

/** Month starts the season ribbon knows are incomplete.
 *
 *  Passed down from the shell rather than recomputed per chart, so every
 *  chart in the section agrees about which months are short. A section
 *  where one chart trusts the final month and another does not would be
 *  worse than either choice made consistently. */
export const partialMonthSet = (months: MonthCell[], isPartial: (m: MonthCell) => boolean) =>
  new Set(months.filter(isPartial).map((m) => m.monthStart));

export const inRangeByMonth = <T extends { month_start: string }>(
  rows: T[],
  range: DateRange | null,
) => (range === null ? rows : rows.filter((r) => r.month_start >= range.start && r.month_start <= range.end));

// ---------------------------------------------------------------------
// Metric 8: membership base and churn
// ---------------------------------------------------------------------

/** Contract types get a fixed colour slot by name, same rule as channels:
 *  by entity, never by rank, so filtering cannot repaint a series. */
const CONTRACT_SLOT: Record<string, string> = {
  gym_monthly: "1",
  gym_annual: "4",
  equestrian_club: "3",
  horse_boarding: "7",
};

export const contractSlot = (type: string) => CONTRACT_SLOT[type] ?? "8";

export const prettyContract = (type: string) =>
  type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export interface MembershipSeries {
  contract_type: string;
  slot: string;
  points: MembershipMonth[];
  latestActive: number;
  latestMrr: number | null;
  /** mean monthly churn over the range, weighted by the base it applied
   *  to rather than a mean of the monthly percentages: a month with 600
   *  members should not count the same as one with 19 */
  churnPct: number | null;
  netChange: number;
}

export function membershipSeries(
  rows: MembershipMonth[],
  range: DateRange | null,
): MembershipSeries[] {
  const scoped = inRangeByMonth(rows, range);
  const byType = new Map<string, MembershipMonth[]>();
  for (const row of scoped) {
    const list = byType.get(row.contract_type) ?? [];
    list.push(row);
    byType.set(row.contract_type, list);
  }

  return [...byType.entries()]
    .map(([contract_type, months]) => {
      const points = months.sort((a, b) => a.month_date_key - b.month_date_key);
      const latest = points[points.length - 1];
      const first = points[0];

      // Weighted churn: total leavers over total exposed base. Summing
      // both sides and dividing once is the only version that survives a
      // month where the base changes sharply.
      let churned = 0;
      let exposed = 0;
      for (let i = 1; i < points.length; i += 1) {
        churned += points[i].churned_count;
        exposed += points[i - 1].active_count;
      }

      return {
        contract_type,
        slot: contractSlot(contract_type),
        points,
        latestActive: latest.active_count,
        latestMrr: latest.active_mrr_kwd,
        churnPct: exposed > 0 ? (churned / exposed) * 100 : null,
        netChange: latest.active_count - first.active_count,
      };
    })
    .sort((a, b) => b.latestActive - a.latestActive);
}

// ---------------------------------------------------------------------
// Metric 11: lesson utilization
// ---------------------------------------------------------------------

/** Levels are ordered by progression, not by value, so the reader always
 *  sees beginner, intermediate, advanced in that order regardless of
 *  which is busiest. A chart that reorders itself as the data changes
 *  makes month-to-month comparison harder, not easier. */
const LEVEL_ORDER = ["beginner", "intermediate", "advanced"];

const LEVEL_SLOT: Record<string, string> = {
  beginner: "1",
  intermediate: "4",
  advanced: "3",
};

export interface LevelSeries {
  level: string;
  slot: string;
  points: { month_key: number; month_start: string; utilizationPct: number | null; capacity: number; booked: number }[];
  totalCapacity: number;
  totalBooked: number;
  /** utilization over the range from the totals, not a mean of monthly
   *  percentages */
  overallPct: number | null;
  /** highest and lowest month, which is what says whether a gap is
   *  seasonal or structural */
  peakPct: number | null;
  troughPct: number | null;
  noShowPct: number | null;
  overbookedCount: number;
  missingAttendance: number;
  instructors: string[];
}

/** Utilization by level and month, rolled up across instructors.
 *
 *  Rolled up because in this client's data each level has exactly one
 *  instructor, so a per-instructor split would be the same three numbers
 *  relabelled, and putting a person's name on a half-empty class implies
 *  the data can separate "this instructor underperforms" from "this level
 *  has less demand". It cannot: the two are perfectly confounded. The
 *  instructor names are carried through so the section can say so. */
export function levelSeries(rows: LessonMonth[], range: DateRange | null): LevelSeries[] {
  const scoped = inRangeByMonth(rows, range);
  const byLevel = new Map<string, LessonMonth[]>();
  for (const row of scoped) {
    const list = byLevel.get(row.level) ?? [];
    list.push(row);
    byLevel.set(row.level, list);
  }

  return [...byLevel.entries()]
    .map(([level, months]) => {
      const byMonth = new Map<number, { capacity: number; booked: number; month_start: string }>();
      let totalCapacity = 0;
      let totalBooked = 0;
      let attendedBooked = 0;
      let attended = 0;
      let overbookedCount = 0;
      let missingAttendance = 0;
      const instructors = new Set<string>();

      for (const row of months) {
        const found = byMonth.get(row.month_key);
        if (found) {
          found.capacity += row.total_capacity;
          found.booked += row.total_booked;
        } else {
          byMonth.set(row.month_key, {
            capacity: row.total_capacity,
            booked: row.total_booked,
            month_start: row.month_start,
          });
        }
        totalCapacity += row.total_capacity;
        totalBooked += row.total_booked;
        overbookedCount += row.overbooked_count;
        missingAttendance += row.missing_attendance_count;
        if (row.total_attended !== null) {
          attended += row.total_attended;
          attendedBooked += row.total_booked;
        }
        if (row.instructor_name) instructors.add(row.instructor_name);
      }

      const points = [...byMonth.entries()]
        .sort(([a], [b]) => a - b)
        .map(([month_key, m]) => ({
          month_key,
          month_start: m.month_start,
          capacity: m.capacity,
          booked: m.booked,
          utilizationPct: m.capacity > 0 ? (m.booked / m.capacity) * 100 : null,
        }));

      const rates = points.map((p) => p.utilizationPct).filter((v): v is number => v !== null);

      return {
        level,
        slot: LEVEL_SLOT[level] ?? "8",
        points,
        totalCapacity,
        totalBooked,
        overallPct: totalCapacity > 0 ? (totalBooked / totalCapacity) * 100 : null,
        peakPct: rates.length > 0 ? Math.max(...rates) : null,
        troughPct: rates.length > 0 ? Math.min(...rates) : null,
        noShowPct:
          attendedBooked > 0 ? ((attendedBooked - attended) / attendedBooked) * 100 : null,
        overbookedCount,
        missingAttendance,
        instructors: [...instructors],
      };
    })
    .sort((a, b) => {
      const ai = LEVEL_ORDER.indexOf(a.level);
      const bi = LEVEL_ORDER.indexOf(b.level);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
}

/** The capacity reallocation the utilization chart is evidence for.
 *
 *  Stated as a comparison of peak-season months rather than annual
 *  averages, because that is when the constraint binds: a level running
 *  at its ceiling in the months everyone wants to ride is turning demand
 *  away, and a level at half capacity in those same months is paying an
 *  instructor to teach air. Outside peak both have slack and there is
 *  nothing to reallocate. */
export function capacitySqueeze(levels: LevelSeries[]): {
  full: LevelSeries;
  empty: LevelSeries;
  fullPeak: number;
  emptyAtFullPeak: number;
} | null {
  const withPeaks = levels.filter((l) => l.peakPct !== null);
  if (withPeaks.length < 2) return null;

  const full = withPeaks.reduce((a, b) => ((a.peakPct as number) >= (b.peakPct as number) ? a : b));
  const empty = withPeaks.reduce((a, b) => ((a.peakPct as number) <= (b.peakPct as number) ? a : b));
  if (full.level === empty.level) return null;

  // A level only counts as constrained if it is essentially at its
  // ceiling, and only worth reallocating from if the other is nowhere
  // near. Both thresholds are deliberately blunt and visible on the
  // chart rather than derived from a test nobody can check by eye.
  const fullPeak = full.peakPct as number;
  if (fullPeak < 95) return null;

  // The emptier level measured in the same months the full one peaks, so
  // the two figures describe the same weather and the same school
  // holidays rather than being each level's own best and worst month.
  const peakMonths = new Set(
    full.points.filter((p) => (p.utilizationPct ?? 0) >= 95).map((p) => p.month_key),
  );
  const emptyInPeak = empty.points.filter((p) => peakMonths.has(p.month_key));
  const capacity = emptyInPeak.reduce((s, p) => s + p.capacity, 0);
  const booked = emptyInPeak.reduce((s, p) => s + p.booked, 0);
  if (capacity === 0) return null;

  const emptyAtFullPeak = (booked / capacity) * 100;
  if (emptyAtFullPeak > 75) return null;

  return { full, empty, fullPeak, emptyAtFullPeak };
}
