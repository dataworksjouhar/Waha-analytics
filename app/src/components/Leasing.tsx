/* Phase 2 session 6: the leasing side of the business.
 *
 * Al Waha has two revenue models under one roof, and this is the landlord
 * half: ten leased units paying base rent plus a percentage of turnover
 * above a threshold. Two of the twelve locked metrics live here, metric 3
 * (turnover rent) and metric 4 (sales per square metre), plus the tenant
 * compliance view that metric 3 depends on and cannot honestly be read
 * without.
 *
 * The order is the order the numbers depend on each other. Rent owed comes
 * first because it is what the GM invoices. Sales per square metre comes
 * second because it is what says whether a unit deserves its rent. And
 * compliance comes last because it is the caveat on both: every figure
 * above rests on a number the tenant typed into a spreadsheet and emailed
 * in three weeks late.
 */

import { useMemo } from "react";
import { formatCurrency, formatNumber, formatPercent } from "../lib/format";
import type { FootfallDay } from "../lib/data";
import {
  filterByMonth,
  footfallByMonth,
  mergeCompliance,
  perSqmMedian,
  rentByMonth,
  summarisePerSqm,
  summariseRent,
  type TenantCompliance,
  type TenantRentMonth,
  type TenantSqmMonth,
} from "../lib/leasing";
import type { DateRange } from "../lib/months";
import { ComplianceChart } from "./charts/ComplianceChart";
import { RentChart } from "./charts/RentChart";
import { SalesPerSqmChart } from "./charts/SalesPerSqmChart";

export function Leasing({
  rent,
  perSqm,
  compliance,
  days,
  range,
  currency,
}: {
  rent: TenantRentMonth[];
  perSqm: TenantSqmMonth[];
  compliance: TenantCompliance[];
  /** daily footfall, already loaded for the footfall section, reused here
   *  as the seasonal yardstick a tenant's own sales are read against */
  days: FootfallDay[];
  range: DateRange | null;
  currency: string;
}) {
  const scopedRent = useMemo(() => filterByMonth(rent, range), [rent, range]);
  const scopedSqm = useMemo(() => filterByMonth(perSqm, range), [perSqm, range]);

  const summary = useMemo(() => summariseRent(scopedRent), [scopedRent]);
  const months = useMemo(() => rentByMonth(scopedRent), [scopedRent]);
  const siteFootfall = useMemo(() => footfallByMonth(days), [days]);
  const tenants = useMemo(
    () => summarisePerSqm(scopedSqm, siteFootfall),
    [scopedSqm, siteFootfall],
  );
  const median = useMemo(() => perSqmMedian(tenants), [tenants]);
  const complianceRows = useMemo(() => mergeCompliance(compliance), [compliance]);

  const flagged = tenants.filter((t) => t.underReporting);

  /** Mean correlation of the unflagged tenants, the "everyone else" the
   *  finding compares a flagged tenant against. Excluding the flagged
   *  tenants keeps the benchmark independent of the thing being tested. */
  const peerCorrelation = useMemo(() => {
    const values = tenants
      .filter((t) => !t.underReporting)
      .map((t) => t.footfallCorrelation)
      .filter((c): c is number => c !== null);
    return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
  }, [tenants]);

  const worstLate = complianceRows[0] ?? null;
  const onTime = complianceRows.filter((t) => (t.avg_days_late ?? 0) <= 0).length;

  return (
    <>
      <section className="card">
        <h2 className="card__title">Turnover rent</h2>
        <p className="card__note">
          Metric 3. Base rent plus a percentage of reported sales above each lease's threshold,
          computed from the terms in <code>dim_tenant</code> against the current version of each
          monthly submission.
        </p>

        <div className="tiles">
          <div className="tile tile--hero">
            <span className="tile__label">Total rent owed</span>
            <span className="tile__value tile__value--hero">
              {formatCurrency(summary.totalOwed, currency)}
            </span>
            <span className="tile__meta">
              across {formatNumber(summary.tenantMonths)} tenant-months
            </span>
          </div>
          <div className="tile">
            <span className="tile__label">Of which turnover rent</span>
            <span className="tile__value">{formatCurrency(summary.turnoverRent, currency)}</span>
            <span className="tile__meta">
              {formatPercent(summary.turnoverSharePct)} of the total, the part that moves with
              trade
            </span>
          </div>
          <div className="tile">
            <span className="tile__label">Months clearing the threshold</span>
            <span className="tile__value">{formatNumber(summary.monthsTriggered)}</span>
            <span className="tile__meta">
              of {formatNumber(summary.tenantMonths)}, the rest paid base rent only
            </span>
          </div>
          <div className="tile">
            <span className="tile__label">Submissions later restated</span>
            <span className="tile__value">{formatNumber(summary.restatedCount)}</span>
            <span className="tile__meta">
              corrected figures replacing an earlier one, rent recomputed on the current version
            </span>
          </div>
        </div>

        <RentChart months={months} currency={currency} />

        {/* The metric is named "owed vs collected" in the architecture
            doc and only half of it can be built. Saying so on the card is
            not a disclaimer, it is the finding: the reason this business
            cannot tell you what it is owed on time is that the data to
            answer it was never collected in the first place. */}
        <p className="chart__note chart__note--caveat">
          Owed only. The nine source systems in this project include no payments or receivables
          feed, so there is no collected figure to set against this one, and inventing a
          collection rate to fill the other half of the metric would be the easiest lie in the
          dashboard. Closing that gap means a source, not a chart.
        </p>
      </section>

      <section className="card">
        <h2 className="card__title">Sales per square metre</h2>
        <p className="card__note">
          Metric 4. Average monthly reported sales divided by unit floor area, which is what makes
          a 45 sqm repair kiosk and a 220 sqm restaurant comparable. Ranked weakest first, against
          the median of the estate.
        </p>

        <SalesPerSqmChart tenants={tenants} median={median} currency={currency} />

        {flagged.length > 0 ? (
          <div className="finding">
            <h3 className="finding__title">
              {flagged.length === 1 ? "One tenant does not fit the estate" : `${formatNumber(flagged.length)} tenants do not fit the estate`}
            </h3>
            {flagged.map((tenant) => (
              <p className="finding__body" key={tenant.tenant_key}>
                <strong>{tenant.tenant_name}</strong> reports{" "}
                {formatNumber(tenant.salesPerSqm, 1)} {currency} per square metre a month,{" "}
                {formatPercent(Math.abs(tenant.vsMedianPct), 0)} below the estate median
                {tenant.vsCategoryPct !== null
                  ? ` and ${formatPercent(Math.abs(tenant.vsCategoryPct), 0)} below its own category`
                  : ", with no tenant in its category to compare against"}
                .{" "}
                {tenant.footfallCorrelation !== null ? (
                  <>
                    Its monthly sales still track site footfall at{" "}
                    {formatNumber(tenant.footfallCorrelation, 2)}, against{" "}
                    {formatNumber(peerCorrelation, 2)} for the rest of the estate. That
                    combination is the thing worth acting on: a unit genuinely trading badly
                    tends to lose the season as well as the level, missing the winter peak that
                    lifts everyone around it. This one keeps the shape of a normal trader and
                    only loses the level, which is what reporting a fixed fraction of true sales
                    looks like from outside the tenant's till.
                  </>
                ) : (
                  <>
                    Too few months in the selected range to compare its seasonal shape against
                    the estate, which is the check that separates a weak trader from a
                    misreported one. Widen the range above.
                  </>
                )}{" "}
                Either way this is an audit before it is a rent review.
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2 className="card__title">Submission compliance</h2>
        <p className="card__note">
          Supporting view for metric 3. Tenants email a spreadsheet after month end and the
          leasing coordinator files it. This is how that actually goes. Whole history: the view
          has no month column, so the season filter above does not apply to it.
        </p>

        <div className="tiles">
          <div className="tile">
            <span className="tile__label">Tenants submitting on time</span>
            <span className="tile__value" data-direction={onTime === 0 ? "down" : undefined}>
              {formatNumber(onTime)} of {formatNumber(complianceRows.length)}
            </span>
            <span className="tile__meta">on or before the month-end deadline</span>
          </div>
          <div className="tile">
            <span className="tile__label">Latest on average</span>
            <span className="tile__value">
              {worstLate ? formatNumber(worstLate.avg_days_late, 0) : "-"}
            </span>
            <span className="tile__meta">days, {worstLate?.tenant_name ?? "-"}</span>
          </div>
          <div className="tile">
            <span className="tile__label">Average across the estate</span>
            <span className="tile__value">{formatNumber(summary.avgDaysLate, 0)}</span>
            <span className="tile__meta">days late, over submissions in the selected range</span>
          </div>
        </div>

        <ComplianceChart tenants={complianceRows} />

        <p className="chart__note">
          None of these submissions is dropped for being late or restated, and none is quietly
          overwritten. Every version is kept in <code>fact_tenant_sales</code>; the reporting
          views read the version that is true today, the same way <code>dim_tenant</code> reads
          its current SCD Type 2 row.
        </p>
      </section>
    </>
  );
}
