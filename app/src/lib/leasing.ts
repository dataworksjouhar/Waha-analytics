/* Types and aggregation for the leasing section (architecture doc metrics
 * 3 and 4, plus the tenant compliance view that supports metric 3).
 *
 * Same rule as lib/footfall.ts: every shape mirrors a view in
 * sql/02_tenants.sql one for one, and a field that is nullable there stays
 * nullable here. The frontend does not get to turn an absent submission
 * into a zero on the way to a chart.
 *
 * One structural difference from the footfall section is worth knowing
 * before reading any of this. These views carry `month_start`, not
 * `full_date`, because fact_tenant_sales has a tenant x month grain: a
 * tenant reports one figure for August, not thirty-one. So the section
 * cannot reuse filterByDate from lib/footfall.ts, and filterByMonth below
 * exists for that reason rather than as a duplicate.
 */

import type { FootfallDay } from "./data";
import type { DateRange } from "./months";

/** One row of gold.vw_tenant_turnover_rent (tenant-version x month).
 *
 *  Note what is NOT here: a collected figure. The nine sources in the
 *  architecture doc include no payments or accounts-receivable feed, so
 *  the view reports what the lease contractually owes and stops there.
 *  Metric 3 is named "owed vs collected"; half of it has no source, and
 *  the honest move is to say so on screen rather than to invent the other
 *  half from the owed figure and a plausible-looking collection rate. */
export interface TenantRentMonth {
  tenant_key: number;
  tenant_id: string;
  tenant_name: string;
  category: string;
  month_date_key: number;
  month_start: string;
  base_rent_kwd: number;
  reported_sales_kwd: number;
  turnover_threshold_kwd: number;
  turnover_rent_pct: number;
  turnover_rent_kwd: number;
  total_rent_owed_kwd: number;
  /** days after month end that the submission arrived */
  days_late: number | null;
  is_restated: boolean;
}

/** One row of gold.vw_tenant_sales_per_sqm (tenant-version x month). */
export interface TenantSqmMonth {
  tenant_key: number;
  tenant_id: string;
  tenant_name: string;
  category: string;
  unit_sqm: number;
  month_date_key: number;
  month_start: string;
  sales_kwd: number;
  sales_per_sqm_kwd: number | null;
}

/** One row of gold.vw_tenant_compliance.
 *
 *  Whole-history, with no month column, so the season filter above the
 *  section does not reach it. Same situation as metric 10 in the footfall
 *  section, and handled the same way: the card says so rather than sitting
 *  there looking filtered. */
export interface TenantCompliance {
  tenant_key: number;
  tenant_id: string;
  tenant_name: string;
  category: string;
  submission_count: number;
  avg_days_late: number | null;
  max_days_late: number | null;
  restated_count: number;
  restated_pct: number | null;
}

// ---------------------------------------------------------------------
// Range filtering
// ---------------------------------------------------------------------

/** A month is in range when its first day is. The season ribbon always
 *  selects whole months (range.start is a month's first day, range.end is
 *  that month's last day), so comparing the single date these rows carry
 *  against the range is exact rather than an approximation: a month whose
 *  start falls inside the window is wholly inside it. */
export const filterByMonth = <T extends { month_start: string }>(
  rows: T[],
  range: DateRange | null,
) => (range === null ? rows : rows.filter((r) => r.month_start >= range.start && r.month_start <= range.end));

// ---------------------------------------------------------------------
// Metric 3: turnover rent
// ---------------------------------------------------------------------

export interface RentSummary {
  tenantMonths: number;
  baseRent: number;
  turnoverRent: number;
  totalOwed: number;
  /** share of total rent that is turnover rather than base, the number
   *  that says whether the turnover clause is doing any work at all */
  turnoverSharePct: number | null;
  /** tenant-months where sales cleared the threshold and turnover rent
   *  was actually charged */
  monthsTriggered: number;
  restatedCount: number;
  /** mean days late across submissions that carry the figure */
  avgDaysLate: number | null;
}

export function summariseRent(rows: TenantRentMonth[]): RentSummary {
  let baseRent = 0;
  let turnoverRent = 0;
  let monthsTriggered = 0;
  let restatedCount = 0;
  let lateTotal = 0;
  let lateCount = 0;

  for (const row of rows) {
    baseRent += row.base_rent_kwd;
    turnoverRent += row.turnover_rent_kwd;
    if (row.turnover_rent_kwd > 0) monthsTriggered += 1;
    if (row.is_restated) restatedCount += 1;
    if (row.days_late !== null) {
      lateTotal += row.days_late;
      lateCount += 1;
    }
  }

  const totalOwed = baseRent + turnoverRent;
  return {
    tenantMonths: rows.length,
    baseRent,
    turnoverRent,
    totalOwed,
    turnoverSharePct: totalOwed > 0 ? (turnoverRent / totalOwed) * 100 : null,
    monthsTriggered,
    restatedCount,
    avgDaysLate: lateCount > 0 ? lateTotal / lateCount : null,
  };
}

export interface RentMonth {
  month_start: string;
  baseRent: number;
  turnoverRent: number;
  totalOwed: number;
  tenantCount: number;
}

/** Rent owed per month, base and turnover kept apart.
 *
 *  Two components rather than one total because they behave differently
 *  and a landlord manages them differently: base rent is contracted and
 *  flat, turnover rent is the part that moves with the season. Stacking
 *  them shows the total while keeping the moving part visible, which a
 *  single total bar would hide completely. */
export function rentByMonth(rows: TenantRentMonth[]): RentMonth[] {
  const months = new Map<string, RentMonth>();
  for (const row of rows) {
    let month = months.get(row.month_start);
    if (!month) {
      month = {
        month_start: row.month_start,
        baseRent: 0,
        turnoverRent: 0,
        totalOwed: 0,
        tenantCount: 0,
      };
      months.set(row.month_start, month);
    }
    month.baseRent += row.base_rent_kwd;
    month.turnoverRent += row.turnover_rent_kwd;
    month.totalOwed += row.total_rent_owed_kwd;
    month.tenantCount += 1;
  }
  return [...months.values()].sort((a, b) => a.month_start.localeCompare(b.month_start));
}

// ---------------------------------------------------------------------
// Metric 4: sales per square metre, and the under-reporting question
// ---------------------------------------------------------------------

/** How far below the all-tenant median a tenant has to sit before the
 *  dashboard calls it out.
 *
 *  Deliberately a plain threshold on a visible number, not a statistical
 *  test. With ten tenants a z-score would be theatre, and the reader can
 *  check this one against the chart with their eyes. It is set at 30
 *  because the observed gap between an ordinary underperformer and the
 *  real signal is wide: in the current data the second-lowest tenant sits
 *  around 14 percent below the median and the flagged one around 44, so
 *  the threshold is not balanced on a knife edge.
 *
 *  Nothing here reads config/client_waha.yml's `under_reporting_tenant`.
 *  That value is the generator's answer key, and a dashboard that pointed
 *  at the planted tenant by ID would be demonstrating nothing. The flag
 *  has to fall out of the reported figures or it is not a finding. */
const UNDER_REPORTING_THRESHOLD_PCT = -30;

export interface TenantSqm {
  /** SCD Type 2 surrogate key: one tenant that changed category appears
   *  as two rows here, one per version, which is the point of the SCD and
   *  not a duplicate to be merged away. Its sales sit in the category it
   *  was actually trading under at the time. */
  tenant_key: number;
  tenant_id: string;
  tenant_name: string;
  category: string;
  unit_sqm: number;
  monthCount: number;
  totalSales: number;
  avgMonthlySales: number;
  /** average monthly sales per square metre, the comparable figure */
  salesPerSqm: number;
  /** gap to the median of all tenant-versions in range, percent */
  vsMedianPct: number;
  /** gap to the median of the tenant's own category, percent, null when
   *  it is the only tenant in that category and there is nobody to
   *  compare against */
  vsCategoryPct: number | null;
  peerCount: number;
  underReporting: boolean;
  /** Pearson correlation between this tenant's monthly sales and total
   *  site footfall over the same months. Null below three months, where
   *  a correlation is arithmetic rather than evidence.
   *
   *  This is the column that separates the two explanations for a tenant
   *  sitting well below its peers. A unit that is genuinely trading badly
   *  usually trades badly unevenly: it misses the winter peak that lifts
   *  everyone else, and its correlation with footfall drops away. A unit
   *  reporting a fixed fraction of its true sales keeps the shape of a
   *  normal trader and only loses the level, so its correlation stays as
   *  high as anyone's. Low level plus normal shape is the signature of a
   *  reporting problem, and it is visible here without any access to the
   *  tenant's real till. */
  footfallCorrelation: number | null;
}

/** Total site footfall per calendar month, keyed "YYYY-MM".
 *
 *  Built from the daily rows the dashboard already loads rather than from
 *  a new view, because the comparison only needs the shape of the season
 *  and the daily grain already carries it. */
export function footfallByMonth(days: FootfallDay[]): Map<string, number> {
  const months = new Map<string, number>();
  for (const day of days) {
    const key = day.full_date.slice(0, 7);
    months.set(key, (months.get(key) ?? 0) + day.footfall);
  }
  return months;
}

/** Pearson correlation. Returns null when either series has no spread,
 *  since a flat series has no direction to agree or disagree with and the
 *  formula would divide by zero. */
function pearson(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null;
  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  let numerator = 0;
  let sumSqA = 0;
  let sumSqB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    sumSqA += da * da;
    sumSqB += db * db;
  }
  const denominator = Math.sqrt(sumSqA * sumSqB);
  return denominator === 0 ? null : numerator / denominator;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** Sales per square metre by tenant-version, weakest first.
 *
 *  The per-tenant figure is total sales over total floor area over the
 *  months present, not the mean of the monthly per-sqm figures. Those
 *  differ whenever a tenant is missing months, and the first is the one
 *  that answers "what does a square metre of this unit earn in a month".
 *
 *  Comparison is against the median rather than the mean because ten
 *  tenants is a small enough group that one outlier drags a mean toward
 *  itself, and the outlier is exactly what this chart is looking for. A
 *  mean would let the tenant being measured move its own benchmark. */
export function summarisePerSqm(
  rows: TenantSqmMonth[],
  siteFootfall: Map<string, number>,
): TenantSqm[] {
  const tenants = new Map<
    number,
    { row: TenantSqmMonth; totalSales: number; monthCount: number; months: TenantSqmMonth[] }
  >();

  for (const row of rows) {
    const found = tenants.get(row.tenant_key);
    if (found) {
      found.totalSales += row.sales_kwd;
      found.monthCount += 1;
      found.months.push(row);
    } else {
      tenants.set(row.tenant_key, {
        row,
        totalSales: row.sales_kwd,
        monthCount: 1,
        months: [row],
      });
    }
  }

  const base = [...tenants.values()]
    .filter((t) => t.row.unit_sqm > 0 && t.monthCount > 0)
    .map((t) => {
      // Only months where both series exist. A tenant month with no
      // footfall figure behind it cannot contribute to a correlation, and
      // padding it with a zero would invent a month the site was shut.
      const paired = t.months
        .map((m) => ({ sales: m.sales_kwd, footfall: siteFootfall.get(m.month_start.slice(0, 7)) }))
        .filter((p): p is { sales: number; footfall: number } => p.footfall !== undefined);

      return {
        tenant_key: t.row.tenant_key,
        tenant_id: t.row.tenant_id,
        tenant_name: t.row.tenant_name,
        category: t.row.category,
        unit_sqm: t.row.unit_sqm,
        monthCount: t.monthCount,
        totalSales: t.totalSales,
        avgMonthlySales: t.totalSales / t.monthCount,
        salesPerSqm: t.totalSales / t.monthCount / t.row.unit_sqm,
        footfallCorrelation: pearson(
          paired.map((p) => p.footfall),
          paired.map((p) => p.sales),
        ),
      };
    });

  if (base.length === 0) return [];

  const allMedian = median(base.map((t) => t.salesPerSqm));

  const byCategory = new Map<string, number[]>();
  for (const tenant of base) {
    const list = byCategory.get(tenant.category) ?? [];
    list.push(tenant.salesPerSqm);
    byCategory.set(tenant.category, list);
  }

  return base
    .map((tenant) => {
      // The tenant's own figure is excluded from its benchmark. Leaving it
      // in would let a tenant that is 40 percent below its peers pull the
      // peer median down toward itself and look closer to normal than it
      // is, and in a two-tenant category it would halve the gap outright.
      const peerValues = (byCategory.get(tenant.category) ?? []).filter(
        (value) => value !== tenant.salesPerSqm,
      );
      const categoryMedian = peerValues.length > 0 ? median(peerValues) : null;
      const vsMedianPct = allMedian > 0 ? (tenant.salesPerSqm / allMedian - 1) * 100 : 0;

      return {
        ...tenant,
        vsMedianPct,
        vsCategoryPct:
          categoryMedian !== null && categoryMedian > 0
            ? (tenant.salesPerSqm / categoryMedian - 1) * 100
            : null,
        peerCount: peerValues.length,
        underReporting: vsMedianPct <= UNDER_REPORTING_THRESHOLD_PCT,
      };
    })
    .sort((a, b) => a.salesPerSqm - b.salesPerSqm);
}

/** The median line the sales-per-sqm chart draws its benchmark at. */
export const perSqmMedian = (tenants: TenantSqm[]): number | null =>
  tenants.length === 0 ? null : median(tenants.map((t) => t.salesPerSqm));

// ---------------------------------------------------------------------
// Supporting view: submission compliance
// ---------------------------------------------------------------------

export interface ComplianceRow extends TenantCompliance {
  /** true when this tenant arrived as more than one SCD Type 2 version
   *  and the rows below were combined */
  merged: boolean;
  versionCount: number;
}

/** Compliance by tenant, with the SCD Type 2 versions of one tenant put
 *  back together.
 *
 *  The view groups by tenant_key, so the tenant that changed category
 *  mid-history arrives as two rows. That split is right for metric 4,
 *  where the category is the thing being compared, and wrong here: the
 *  leasing coordinator chases a tenant, not a surrogate key, and showing
 *  the same shop twice would misstate how many tenants are late.
 *
 *  Days late is recombined as a submission-weighted mean rather than the
 *  mean of the two means, which would let eleven submissions and thirteen
 *  submissions count equally. */
export function mergeCompliance(rows: TenantCompliance[]): ComplianceRow[] {
  interface Accumulator extends ComplianceRow {
    /** submissions x avg days late, summed, so the weighted mean can be
     *  divided out once at the end rather than re-averaged per merge */
    lateTotal: number;
    lateCount: number;
    /** submissions behind the currently chosen category label */
    categorySubmissions: number;
  }

  const merged = new Map<string, Accumulator>();

  for (const row of rows) {
    const lateTotal = row.avg_days_late === null ? 0 : row.avg_days_late * row.submission_count;
    const lateCount = row.avg_days_late === null ? 0 : row.submission_count;
    const found = merged.get(row.tenant_id);

    if (!found) {
      merged.set(row.tenant_id, {
        ...row,
        merged: false,
        versionCount: 1,
        lateTotal,
        lateCount,
        categorySubmissions: row.submission_count,
      });
      continue;
    }

    // The surviving category label is the one from the version with the
    // most submissions behind it, so the row reads as the tenant's usual
    // trade rather than as whichever version the export wrote first.
    if (row.submission_count > found.categorySubmissions) {
      found.category = row.category;
      found.categorySubmissions = row.submission_count;
    }

    found.submission_count += row.submission_count;
    found.restated_count += row.restated_count;
    found.max_days_late = Math.max(found.max_days_late ?? 0, row.max_days_late ?? 0);
    found.lateTotal += lateTotal;
    found.lateCount += lateCount;
    found.versionCount += 1;
    found.merged = true;
  }

  return [...merged.values()]
    .map(({ lateTotal, lateCount, categorySubmissions, ...row }) => ({
      ...row,
      avg_days_late: lateCount > 0 ? lateTotal / lateCount : null,
      restated_pct:
        row.submission_count > 0 ? (row.restated_count / row.submission_count) * 100 : null,
    }))
    .sort((a, b) => (b.avg_days_late ?? -1) - (a.avg_days_late ?? -1));
}
