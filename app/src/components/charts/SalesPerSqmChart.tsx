/* Metric 4: sales per square metre by tenant, weakest first.
 *
 * Floor area is what makes ten tenants comparable. Sahara Grill turns over
 * three times what TechFix does and occupies nearly five times the space,
 * so raw sales rank the units by size and tell a landlord nothing. Per
 * square metre is the figure a leasing decision actually rests on.
 *
 * Sorted ascending so the weakest unit is the first thing read, because
 * this chart exists to find a problem rather than to celebrate the top of
 * the table. A median reference line gives every bar something to be read
 * against: without it "47" is a number, and with it "47" is visibly a
 * little over half of what the middle of the estate earns.
 *
 * The flag is computed in lib/leasing.ts from the reported figures alone.
 * Nothing here knows which tenant the generator planted.
 */

import { useState } from "react";
import { barPath, domainFrom, niceTicks, scaleLinear } from "../../lib/chart";
import { formatCurrency, formatNumber, formatPercent } from "../../lib/format";
import type { TenantSqm } from "../../lib/leasing";
import { TableView } from "./TableView";

const W = 900;
const LABEL_W = 230;
const PAD_R = 96;
const BAR = 16;
const ROW = 40;
const TOP = 22;

export function SalesPerSqmChart({
  tenants,
  median,
  currency,
}: {
  tenants: TenantSqm[];
  median: number | null;
  currency: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (tenants.length === 0) {
    return <p className="chart__empty">No tenant submissions in the selected range.</p>;
  }

  const domain = domainFrom(tenants.map((t) => t.salesPerSqm));
  const x = scaleLinear(domain, [LABEL_W, W - PAD_R]);
  const ticks = niceTicks(domain[0], domain[1], 4);
  const height = TOP + tenants.length * ROW + 34;
  const zero = x(0);
  const plotBottom = height - 34;

  return (
    <div className="chart">
      <div className="chart__legend">
        <span className="chart__key">
          <span className="chart__swatch" data-series="1" />
          Sales per square metre, monthly average
        </span>
        <span className="chart__key">
          <span className="chart__swatch" data-status="critical" />
          More than 30% below the estate median
        </span>
        <span className="chart__key">
          <span className="chart__swatch chart__swatch--rule" />
          Estate median
        </span>
      </div>

      <div className="chart__figure">
        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${height}`}
          role="img"
          aria-label="Average monthly sales per square metre by tenant, weakest first"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart__grid" x1={x(tick)} x2={x(tick)} y1={TOP} y2={plotBottom} />
              <text className="chart__tick" x={x(tick)} y={height - 16} textAnchor="middle">
                {formatNumber(tick)}
              </text>
            </g>
          ))}

          {median !== null ? (
            <g>
              <line
                className="chart__rule"
                x1={x(median)}
                x2={x(median)}
                y1={TOP - 12}
                y2={plotBottom}
              />
              <text className="chart__annotation" x={x(median) + 6} y={TOP - 4}>
                Median {formatNumber(median)}
              </text>
            </g>
          ) : null}

          {tenants.map((tenant, index) => {
            const rowTop = TOP + index * ROW;
            const barY = rowTop + (ROW - BAR) / 2;
            const width = x(tenant.salesPerSqm) - zero;
            return (
              <g
                key={tenant.tenant_key}
                onPointerEnter={() => setHover(index)}
                onPointerLeave={() => setHover(null)}
              >
                {hover === index ? (
                  <rect className="chart__row-band" x={0} y={rowTop} width={W} height={ROW} />
                ) : null}
                <rect className="chart__hit" x={0} y={rowTop} width={W} height={ROW} />

                <text
                  className="chart__row-label"
                  data-flagged={tenant.underReporting ? "true" : undefined}
                  x={0}
                  y={rowTop + 17}
                >
                  {tenant.tenant_name}
                </text>
                <text className="chart__row-sub" x={0} y={rowTop + 31}>
                  {tenant.category}, {formatNumber(tenant.unit_sqm)} sqm
                </text>

                {/* Status red is reserved for the flag and is never a
                    categorical slot, so a red bar here always means the
                    same thing it means everywhere else in the dashboard.
                    It never travels alone: the name turns red too, the
                    gap is printed as text, and the table repeats it. */}
                <path
                  className="chart__bar"
                  data-series={tenant.underReporting ? undefined : "1"}
                  data-status={tenant.underReporting ? "critical" : undefined}
                  d={barPath(zero, barY, width, BAR, 4, "right")}
                />
                <text className="chart__bar-label" x={x(tenant.salesPerSqm) + 8} y={barY + BAR - 3}>
                  {formatNumber(tenant.salesPerSqm, 1)}
                  <tspan className="chart__bar-delta" dx="6">
                    {tenant.vsMedianPct > 0 ? "+" : ""}
                    {formatPercent(Math.round(tenant.vsMedianPct), 0)}
                  </tspan>
                </text>
              </g>
            );
          })}

          <line className="chart__axis" x1={zero} x2={zero} y1={TOP} y2={plotBottom} />
          <text className="chart__panel-title" x={0} y={height - 2}>
            {currency} per square metre per month
          </text>
        </svg>
      </div>

      <TableView
        label="Table view: sales per square metre by tenant"
        caption="One row per tenant version. The tenant that changed category mid-history appears twice by design, its sales sitting in the category it traded under at the time. Category gap is against the median of its peers with its own figure excluded, and is blank where it has no peer. Tracks footfall is the correlation between the tenant's monthly sales and total site footfall: a normal trader sits high, and a low figure means the unit is missing the season everyone else is riding."
        columns={[
          { key: "tenant", label: "Tenant", render: (t: TenantSqm) => t.tenant_name },
          { key: "category", label: "Category", render: (t) => t.category },
          {
            key: "sqm",
            label: "Unit sqm",
            align: "right",
            render: (t) => formatNumber(t.unit_sqm),
          },
          {
            key: "months",
            label: "Months",
            align: "right",
            render: (t) => formatNumber(t.monthCount),
          },
          {
            key: "avg",
            label: `Avg monthly sales ${currency}`,
            align: "right",
            render: (t) => formatCurrency(t.avgMonthlySales, currency),
          },
          {
            key: "persqm",
            label: `Per sqm ${currency}`,
            align: "right",
            render: (t) => formatNumber(t.salesPerSqm, 1),
          },
          {
            key: "vsmedian",
            label: "vs estate median",
            align: "right",
            render: (t) => `${t.vsMedianPct > 0 ? "+" : ""}${formatPercent(t.vsMedianPct, 0)}`,
          },
          {
            key: "vscategory",
            label: "vs category peers",
            align: "right",
            render: (t) =>
              t.vsCategoryPct === null
                ? "no peer"
                : `${t.vsCategoryPct > 0 ? "+" : ""}${formatPercent(t.vsCategoryPct, 0)}`,
          },
          {
            key: "corr",
            label: "Tracks footfall",
            align: "right",
            render: (t) => formatNumber(t.footfallCorrelation, 2),
          },
        ]}
        rows={tenants}
        rowKey={(t) => String(t.tenant_key)}
      />
    </div>
  );
}
