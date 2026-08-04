/* Types and the aggregation behind the site plan.
 *
 * The map is a choropleth: each leased unit is a plot whose AREA is true
 * to its floor area (computed in the exporter from dim_tenant.unit_sqm)
 * and whose FILL encodes whichever metric is selected. Two encodings on
 * one mark, and they answer different questions: size asks "how much
 * space is this costing", fill asks "what is it returning".
 *
 * That pairing is the whole argument for a map over a table. In a table,
 * a big weak unit and a small weak unit are two similar-looking rows. On
 * the plan the first is a large pale rectangle, and it is the thing your
 * eye lands on first.
 */

export interface SiteUnit {
  unit_no: string;
  terrace_id: string;
  terrace_label: string;
  /** which way the terrace runs, so labels sit beside vertical plots
   *  rather than underneath, where they would land on the next unit */
  orientation: "horizontal" | "vertical";
  tenant_id: string;
  tenant_name: string;
  category: string;
  status: string;
  unit_sqm: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SiteVenue {
  venue_id: string;
  label: string;
  rect: [number, number, number, number];
  venue_name: string;
  venue_type: string;
}

export interface SiteGate {
  gate_id: string;
  at: [number, number];
  label_side: string;
  gate_name: string;
  description: string;
}

export interface SitePlanData {
  viewbox: [number, number, number, number];
  note: string;
  units: SiteUnit[];
  venues: SiteVenue[];
  gates: SiteGate[];
  promenade: [number, number][];
}

/** One row of gold.vw_tenant_site_metrics (tenant x month). */
export interface TenantSiteMetric {
  tenant_id: string;
  tenant_name: string;
  category: string;
  unit_no: string;
  unit_sqm: number;
  status: string;
  month_start: string;
  sales_kwd: number | null;
  sales_per_sqm_kwd: number | null;
  total_rent_owed_kwd: number | null;
  days_late: number | null;
  is_restated: boolean;
}

/** One row of gold.vw_footfall_gate_hour_monthly (gate x month x hour). */
export interface GateHourFootfall {
  gate_id: string;
  gate_name: string;
  month_start: string;
  hour: number;
  avg_count_in: number;
  total_count_in: number;
  has_imputed: boolean;
  has_corrected: boolean;
}

export interface FillMetric {
  id: string;
  label: string;
  /** what a dark plot means, for the legend */
  highMeans: string;
  format: "currency" | "number" | "days";
  /** pulls the per-month value this metric aggregates */
  value: (row: TenantSiteMetric) => number | null;
  /** how monthly values combine over the selected range */
  aggregate: "sum" | "mean";
}

export const FILL_METRICS: FillMetric[] = [
  {
    id: "sales_per_sqm",
    label: "Sales per sqm",
    highMeans: "trading harder per square metre",
    format: "currency",
    value: (r) => r.sales_per_sqm_kwd,
    aggregate: "mean",
  },
  {
    id: "sales",
    label: "Reported sales",
    highMeans: "higher total sales",
    format: "currency",
    value: (r) => r.sales_kwd,
    aggregate: "sum",
  },
  {
    id: "rent",
    label: "Rent owed",
    highMeans: "more rent owed",
    format: "currency",
    value: (r) => r.total_rent_owed_kwd,
    aggregate: "sum",
  },
  {
    id: "days_late",
    label: "Days late filing",
    highMeans: "files later",
    format: "days",
    value: (r) => r.days_late,
    aggregate: "mean",
  },
];

export interface UnitValue {
  unit_no: string;
  value: number | null;
  monthCount: number;
  restatedCount: number;
}

/** Rolls the tenant-month rows up to one value per unit for the selected
 *  range. Units with no submission in the range come back null rather than
 *  zero: a tenant who filed nothing and a tenant who sold nothing are
 *  different facts, and colouring both as "lowest" would invent data. */
export function aggregateByUnit(
  rows: TenantSiteMetric[],
  metric: FillMetric,
): Map<string, UnitValue> {
  const byUnit = new Map<string, { values: number[]; restated: number }>();

  for (const row of rows) {
    const value = metric.value(row);
    let bucket = byUnit.get(row.unit_no);
    if (!bucket) {
      bucket = { values: [], restated: 0 };
      byUnit.set(row.unit_no, bucket);
    }
    if (value !== null) bucket.values.push(value);
    if (row.is_restated) bucket.restated += 1;
  }

  const result = new Map<string, UnitValue>();
  for (const [unit_no, bucket] of byUnit) {
    const total = bucket.values.reduce((a, b) => a + b, 0);
    result.set(unit_no, {
      unit_no,
      value:
        bucket.values.length === 0
          ? null
          : metric.aggregate === "sum"
            ? total
            : total / bucket.values.length,
      monthCount: bucket.values.length,
      restatedCount: bucket.restated,
    });
  }
  return result;
}

/** Rank-based buckets across the five ramp steps.
 *
 *  Rank rather than equal-width bins because ten units is a small enough
 *  set that one strong performer would otherwise push every other plot
 *  into the palest step and flatten the map into "one dark box and nine
 *  identical pale ones". Ranking guarantees the ramp is actually used.
 *  The legend prints the real values at each end, so the reader is never
 *  left guessing what a step is worth. */
export function bucketByRank(values: Map<string, UnitValue>, steps = 5): Map<string, number> {
  const ranked = [...values.values()]
    .filter((v) => v.value !== null)
    .sort((a, b) => (a.value as number) - (b.value as number));

  const buckets = new Map<string, number>();
  ranked.forEach((entry, index) => {
    const step = Math.min(steps - 1, Math.floor((index / ranked.length) * steps));
    buckets.set(entry.unit_no, step + 1);
  });
  return buckets;
}

export const HOURS_ALL = -1;

/** The busiest hour at each gate over the selected months.
 *
 *  Shown in the gate tooltip in place of dim_gate.description. The
 *  description is static text about where a gate sits, which the reader
 *  can already see on the plan; the peak hour is a fact about the
 *  business, and it is the one that shifts during Ramadan. */
export function gatePeakHours(
  rows: GateHourFootfall[],
  monthKeys: Set<string>,
): Map<string, number> {
  const totals = new Map<string, Map<number, number>>();

  for (const row of rows) {
    if (!monthKeys.has(row.month_start)) continue;
    let byHour = totals.get(row.gate_id);
    if (!byHour) {
      byHour = new Map();
      totals.set(row.gate_id, byHour);
    }
    byHour.set(row.hour, (byHour.get(row.hour) ?? 0) + row.avg_count_in);
  }

  const peaks = new Map<string, number>();
  for (const [gate_id, byHour] of totals) {
    const [peakHour] = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
    peaks.set(gate_id, peakHour);
  }
  return peaks;
}

/** Average visitors entering a gate, for the selected months and hour.
 *  HOURS_ALL sums the day rather than averaging across hours, because
 *  "visitors per day" is the number a reader expects when no hour is
 *  selected. */
export function gateVolumes(
  rows: GateHourFootfall[],
  monthKeys: Set<string>,
  hour: number,
): Map<string, { value: number; imputed: boolean }> {
  const byGate = new Map<string, { total: number; months: Set<string>; imputed: boolean }>();

  for (const row of rows) {
    if (!monthKeys.has(row.month_start)) continue;
    if (hour !== HOURS_ALL && row.hour !== hour) continue;

    let bucket = byGate.get(row.gate_id);
    if (!bucket) {
      bucket = { total: 0, months: new Set(), imputed: false };
      byGate.set(row.gate_id, bucket);
    }
    bucket.total += row.avg_count_in;
    bucket.months.add(row.month_start);
    bucket.imputed = bucket.imputed || row.has_imputed;
  }

  const result = new Map<string, { value: number; imputed: boolean }>();
  for (const [gate_id, bucket] of byGate) {
    result.set(gate_id, {
      value: bucket.total / Math.max(bucket.months.size, 1),
      imputed: bucket.imputed,
    });
  }
  return result;
}
