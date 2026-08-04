/* Types and aggregation for the data quality section.
 *
 * Two different things live here and conflating them would defeat the
 * point of the section:
 *
 *   checks       gold.dq.check_results, written by the pipeline's own
 *                checks module. These answer "is the warehouse internally
 *                consistent": do the keys join, are the grains unique, is
 *                the data fresh.
 *
 *   imperfections the deliberate mess in the source files (architecture
 *                doc section 3), counted from the same exports the charts
 *                upstairs are drawn from.
 *
 * The distinction matters because every check passes, and a panel showing
 * only that would say something false by implication. All checks passing
 * does not mean the data arrived clean. It means the mess was handled:
 * detected, flagged, carried through, and still visible in the numbers.
 * The census below is the evidence for that, and it is computed rather
 * than written down, so it cannot drift away from what the dashboard
 * actually shows.
 */

import type { FootfallDay } from "./data";
import type { EventRoi, VenueAtv } from "./footfall";
import type { TenantCompliance, TenantRentMonth } from "./leasing";
import type { ChannelConversion, TicketChannelMix } from "./online";
import type { InstructorCoverage, LessonMonth } from "./recurring";

/** One row of dq.check_results, as exported. */
export interface DqCheck {
  check_name: string;
  check_type: string;
  schema_name: string;
  table_name: string | null;
  status: string;
  severity: string;
  expected_value: string | null;
  actual_value: string | null;
  details: string | null;
  checked_at: string;
}

export interface CheckGroup {
  check_type: string;
  label: string;
  description: string;
  checks: DqCheck[];
  passed: number;
  failed: number;
}

/* What each check type is actually asserting, in the language of the
 * business rather than of the pipeline. A reader who has to already know
 * what "referential integrity" means is not the reader this panel is
 * for. */
const CHECK_TYPE_COPY: Record<string, { label: string; description: string }> = {
  uniqueness: {
    label: "Grain",
    description:
      "Every table holds one row per thing it claims to describe. One current version per tenant, one row per gate per hour, one row per contract per month. A duplicate here would silently double a number somewhere upstairs.",
  },
  referential_integrity: {
    label: "Joins",
    description:
      "Every foreign key in a fact table points at a row that exists. A booking with no product, a lesson with no instructor, or a sale with no date would drop out of any chart that joins, and would do so quietly.",
  },
  row_count: {
    label: "Completeness",
    description:
      "The gold layer kept what silver gave it. Deliberate losses (deduplicated re-exports, cancelled rows) are expected and bounded; an unexplained shortfall is not.",
  },
  value_range: {
    label: "Plausibility",
    description:
      "Values sit inside what the business permits. Footfall is never negative, attendance never exceeds bookings, a refund always carries a negative amount, net sales never exceed gross.",
  },
  freshness: {
    label: "Freshness",
    description:
      "Each source arrived up to the date it should have. On a live client this is the check that catches a feed that quietly stopped, which is the most common real failure of all.",
  },
};

export function groupChecks(checks: DqCheck[]): CheckGroup[] {
  const groups = new Map<string, DqCheck[]>();
  for (const check of checks) {
    const list = groups.get(check.check_type) ?? [];
    list.push(check);
    groups.set(check.check_type, list);
  }

  return [...groups.entries()]
    .map(([check_type, list]) => ({
      check_type,
      label: CHECK_TYPE_COPY[check_type]?.label ?? check_type.replace(/_/g, " "),
      description: CHECK_TYPE_COPY[check_type]?.description ?? "",
      checks: list.sort((a, b) => a.check_name.localeCompare(b.check_name)),
      passed: list.filter((c) => c.status === "pass").length,
      failed: list.filter((c) => c.status !== "pass").length,
    }))
    // Failures first: a panel that buries its own bad news is decoration.
    .sort((a, b) => b.failed - a.failed || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------
// The imperfection census
// ---------------------------------------------------------------------

export interface Imperfection {
  id: string;
  /** what the source system did wrong */
  problem: string;
  /** the measured size of it, from the same data the charts use */
  count: number;
  unit: string;
  /** what the pipeline did about it, and why that choice */
  handling: string;
  /** where in the dashboard the consequence is visible */
  visibleIn: string;
  /** true when the honest answer is a question for the client rather
   *  than something the pipeline can resolve on its own */
  openQuestion?: boolean;
}

export interface CensusInput {
  days: FootfallDay[];
  rent: TenantRentMonth[];
  compliance: TenantCompliance[];
  lessons: LessonMonth[];
  instructors: InstructorCoverage[];
  events: EventRoi[];
  channels: ChannelConversion[];
  mix: TicketChannelMix[];
  atv: VenueAtv[];
}

/** Counts every deliberate imperfection from the exported data.
 *
 *  Nothing here is a stored number. If a future generator run changes how
 *  much mess it injects, these figures move with it, and if the pipeline
 *  ever started silently dropping the bad rows the counts would fall to
 *  zero and the omission would be visible on this page rather than
 *  invisible everywhere. */
export function census(input: CensusInput): Imperfection[] {
  const imputedDays = input.days.filter((d) => d.has_imputed_hours).length;
  const correctedDays = input.days.filter((d) => d.has_corrected_hours).length;
  const restated = input.rent.filter((r) => r.is_restated).length;
  const veryLate = input.rent.filter((r) => (r.days_late ?? 0) > 30).length;
  const overbooked = input.lessons.reduce((s, l) => s + l.overbooked_count, 0);
  const unmarked = input.lessons.reduce((s, l) => s + l.missing_attendance_count, 0);
  const idleInstructors = input.instructors.filter((i) => i.lesson_count === 0).length;
  const unmeasurableEvents = input.events.filter((e) => e.footfall_uplift_per_day === null).length;
  const unattributed = input.channels
    .filter((c) => c.sessions === null || c.sessions === 0)
    .reduce((s, c) => s + c.booking_count, 0);
  const refunds = input.atv.reduce((s, v) => s + v.refund_invoice_count, 0);
  const scdVersions = input.compliance.length - new Set(input.compliance.map((c) => c.tenant_id)).size;
  const crosswalkedGroups = new Set(
    input.mix.filter((m) => m.online_qty === 0 && m.walk_in_qty > 0 && m.category === "ticket")
      .map((m) => m.venue_name),
  ).size;

  const all: Imperfection[] = [
    {
      id: "sensor-outage",
      problem: "A footfall sensor went dead and reported nothing for a stretch of hours.",
      count: imputedDays,
      unit: imputedDays === 1 ? "day carrying imputed hours" : "days carrying imputed hours",
      handling:
        "The missing hours are filled from the same gate's typical profile for that weekday and hour, and every filled row carries is_imputed. The estimate is used, never hidden, and any day containing one is flagged on the footfall chart.",
      visibleIn: "Footfall and sales, days carrying a data flag",
    },
    {
      id: "sensor-doublecount",
      problem: "A second sensor intermittently double-counted, reporting roughly twice its neighbours.",
      count: correctedDays,
      unit: "days carrying a corrected hour",
      handling:
        "Outliers are detected against neighbouring gates and corrected, with is_outlier_corrected set. The correction is a judgement, so it is labelled as one rather than folded silently into the headline count.",
      visibleIn: "Footfall and sales, days carrying a data flag",
    },
    {
      id: "gate-names",
      problem:
        "Gate names arrived inconsistently across files: Gate 1, GATE_1 and G1 all meant the same physical sensor.",
      count: 4,
      unit: "sensors conformed to 2 entrances",
      handling:
        "An alias table in pipeline/transform/footfall.py maps every spelling onto one dim_gate row. The four physical sensors roll up to the two entrances the site actually has, and both grains are kept.",
      visibleIn: "Site plan, and the per-entrance denominator in metric 2",
    },
    {
      id: "tenant-restated",
      problem:
        "Tenants email a spreadsheet after month end, and roughly one in ten later sends a corrected figure.",
      count: restated,
      unit: "submissions restated",
      handling:
        "Every version is kept in fact_tenant_sales with a submission_version. Reporting views read the version that is true today, the same way dim_tenant reads its current SCD Type 2 row. Nothing is overwritten.",
      visibleIn: "Leasing, submission compliance",
    },
    {
      id: "tenant-late",
      problem: "Submissions arrive between 5 and 40 days after month end, and none arrive on time.",
      count: veryLate,
      unit: "submissions more than 30 days late",
      handling:
        "days_late is computed and reported rather than ignored. It is the reason the turnover rent figure carries a caveat: rent owed is only as current as the last spreadsheet that arrived.",
      visibleIn: "Leasing, submission compliance",
    },
    {
      id: "tenant-scd",
      problem: "One tenant changed category mid-history, and one closed partway through.",
      count: scdVersions,
      unit: "extra tenant version from an SCD Type 2 change",
      handling:
        "dim_tenant is SCD Type 2, so the tenant's sales sit in the category it was actually trading under at the time. Sales per square metre keeps the versions apart because category is what is being compared; compliance merges them because the leasing coordinator chases a shop, not a surrogate key.",
      visibleIn: "Leasing, both charts",
    },
    {
      id: "refunds",
      problem: "The POS export contains refunds as negative quantities, plus duplicate lines from re-exports.",
      count: refunds,
      unit: "refund invoices",
      handling:
        "Refunds are kept as negative rows with is_refund rather than dropped, so revenue nets correctly. Average transaction value counts them separately instead of averaging them in, because a refund is not a small sale. Duplicate re-export lines are deduplicated in silver and the dedup is itself a check.",
      visibleIn: "Footfall and sales, average transaction value",
    },
    {
      id: "overbooked",
      problem: "Lesson slots were sometimes booked past their stated capacity.",
      count: overbooked,
      unit: "slots booked over capacity",
      handling:
        "Flagged with is_overbooked and left at its real value rather than clamped to capacity. Clamping would have hidden the most useful thing in the equestrian section: the beginner classes are turning demand away.",
      visibleIn: "Membership and equestrian, lesson utilization",
    },
    {
      id: "attendance",
      problem: "Coaches did not always mark attendance after a lesson.",
      count: unmarked,
      unit: "slots with attendance never marked",
      handling:
        "Excluded from the no-show denominator rather than counted as full attendance. A missing mark is not evidence that everybody turned up, and the count is carried alongside the rate so the gap is visible.",
      visibleIn: "Membership and equestrian, lesson utilization table",
    },
    {
      id: "instructor-roster",
      problem: "An instructor sits on the roster as active but appears against no lessons at all.",
      count: idleInstructors,
      unit: "instructor with no lessons in two years",
      handling:
        "Surfaced through vw_instructor_coverage, which reads from the dimension outward. The utilization view could never show this: an instructor with no lessons has no row in it. Whether this is a scheduling gap or an export gap is a question for the client.",
      visibleIn: "Membership and equestrian, the caveat under lesson utilization",
      openQuestion: true,
    },
    {
      id: "event-dates",
      problem: "One event in the calendar has an end date before its start date.",
      count: unmeasurableEvents,
      unit: "event that cannot be measured",
      handling:
        "It matches no calendar days, so it has no uplift to compute. It is kept in the data and shown on the chart as unmeasurable rather than filtered out, because an event nobody can evaluate is itself worth knowing about.",
      visibleIn: "Footfall and sales, event ROI",
    },
    {
      id: "attribution",
      problem: "A share of website bookings arrived with no acquisition channel recorded.",
      count: unattributed,
      unit: "bookings with no channel",
      handling:
        "Held in their own bucket rather than dropped or spread proportionally across the named channels. Splitting them would have inflated exactly the channel the online section warns about, and the money is real even though the referrer is not known.",
      visibleIn: "Online, the note under conversion by channel",
    },
    {
      id: "sku-crosswalk",
      problem:
        "The booking website sells one ticket per venue while the till sells adult, child and family variants.",
      count: crosswalkedGroups,
      unit: "venues where online and till SKUs do not line up",
      handling:
        "A documented crosswalk pins each online product onto one representative SKU. The dashboard reports the mix at venue and category grain, where the two channels are genuinely comparable, rather than at SKU grain where the online share would be an artifact of the crosswalk.",
      visibleIn: "Online, online versus walk-in",
    },
    {
      id: "member-identity",
      problem:
        "Members holding both a gym and an equestrian membership appear under different member IDs in the source.",
      count: 1,
      unit: "identity resolution rule",
      handling:
        "Resolved on phone number in silver so one person is one dim_member row, which keeps the active base and churn honest. Anyone who used a different number in each system stays two rows, and that is stated rather than assumed away.",
      visibleIn: "Membership and equestrian, membership base",
    },
  ];

  // A census entry whose count has fallen to zero is dropped rather than
  // shown as a proud zero. If the generator stops injecting a given kind
  // of mess, the honest page is one that no longer claims to handle it.
  return all.filter((item) => item.count > 0);
}

export const censusTotal = (items: Imperfection[]) =>
  items.reduce((total, item) => total + item.count, 0);
