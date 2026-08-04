/* Supporting view for metric 3: how late tenants submit, and how often
 * they restate.
 *
 * Not a bar chart. Every tenant here submits somewhere between 19 and 27
 * days late on average, so bars from a zero baseline would be ten near
 * identical lengths and the differences that matter would be invisible.
 * A dot for the average with a line running out to the worst submission
 * says the thing the landlord needs: not "how late are they" but "how far
 * does this tenant swing", which is the difference between a tenant who is
 * reliably three weeks late and one who is occasionally two months late.
 *
 * The contract deadline is drawn as a reference line at zero days, and
 * every single tenant sits well to the right of it. That is the finding.
 * Nobody on this estate submits on time, which is exactly the condition
 * that makes turnover rent hard to invoice and is the honest reason
 * metric 3 carries a caveat.
 */

import { useState } from "react";
import { domainFrom, niceTicks, scaleLinear } from "../../lib/chart";
import { formatNumber, formatPercent } from "../../lib/format";
import type { ComplianceRow } from "../../lib/leasing";
import { TableView } from "./TableView";

const W = 900;
const LABEL_W = 230;
const PAD_R = 70;
const ROW = 34;
const TOP = 20;

export function ComplianceChart({ tenants }: { tenants: ComplianceRow[] }) {
  const [hover, setHover] = useState<string | null>(null);

  if (tenants.length === 0) {
    return <p className="chart__empty">No tenant submissions recorded.</p>;
  }

  const domain = domainFrom(
    tenants.flatMap((t) => [t.avg_days_late, t.max_days_late].filter((n): n is number => n !== null)),
  );
  const x = scaleLinear(domain, [LABEL_W, W - PAD_R]);
  const ticks = niceTicks(domain[0], domain[1], 5);
  const height = TOP + tenants.length * ROW + 34;
  const plotBottom = height - 34;

  return (
    <div className="chart">
      <div className="chart__legend">
        <span className="chart__key">
          <span className="chart__swatch chart__swatch--dot" data-series="1" />
          Average days late
        </span>
        <span className="chart__key">
          <span className="chart__swatch chart__swatch--line" data-series="1" />
          Out to the worst submission
        </span>
      </div>

      <div className="chart__figure">
        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${height}`}
          role="img"
          aria-label="Average and worst submission lateness by tenant, in days after month end"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart__grid" x1={x(tick)} x2={x(tick)} y1={TOP} y2={plotBottom} />
              <text className="chart__tick" x={x(tick)} y={height - 16} textAnchor="middle">
                {formatNumber(tick)}
              </text>
            </g>
          ))}

          {tenants.map((tenant, index) => {
            const rowTop = TOP + index * ROW;
            const centre = rowTop + ROW / 2;
            const avg = tenant.avg_days_late;
            const max = tenant.max_days_late;
            return (
              <g
                key={tenant.tenant_id}
                onPointerEnter={() => setHover(tenant.tenant_id)}
                onPointerLeave={() => setHover(null)}
              >
                {hover === tenant.tenant_id ? (
                  <rect className="chart__row-band" x={0} y={rowTop} width={W} height={ROW} />
                ) : null}
                <rect className="chart__hit" x={0} y={rowTop} width={W} height={ROW} />

                <text className="chart__row-label" x={0} y={centre + 4}>
                  {tenant.tenant_name}
                </text>

                {avg !== null && max !== null ? (
                  <line
                    className="chart__range"
                    x1={x(avg)}
                    x2={x(max)}
                    y1={centre}
                    y2={centre}
                  />
                ) : null}
                {max !== null ? (
                  <circle className="chart__marker--hollow" cx={x(max)} cy={centre} r={4} />
                ) : null}
                {avg !== null ? (
                  <circle className="chart__marker" data-series="1" cx={x(avg)} cy={centre} r={5} />
                ) : null}

                <text className="chart__bar-label" x={W - PAD_R + 10} y={centre + 4}>
                  {formatNumber(avg, 0)} / {formatNumber(max, 0)}
                </text>
              </g>
            );
          })}

          <line className="chart__axis" x1={x(0)} x2={x(0)} y1={TOP} y2={plotBottom} />
          <text className="chart__panel-title" x={0} y={height - 2}>
            Days after month end. Zero is the contractual deadline.
          </text>
        </svg>
      </div>

      <TableView
        label="Table view: tenant submission compliance"
        caption="Whole history, so the season filter above does not apply. Days late is weighted by submissions, so a tenant that traded under two lease versions is not counted twice."
        columns={[
          { key: "tenant", label: "Tenant", render: (t: ComplianceRow) => t.tenant_name },
          { key: "category", label: "Category", render: (t) => t.category },
          {
            key: "subs",
            label: "Submissions",
            align: "right",
            render: (t) => formatNumber(t.submission_count),
          },
          {
            key: "avg",
            label: "Avg days late",
            align: "right",
            render: (t) => formatNumber(t.avg_days_late, 1),
          },
          {
            key: "max",
            label: "Worst",
            align: "right",
            render: (t) => formatNumber(t.max_days_late),
          },
          {
            key: "restated",
            label: "Restated",
            align: "right",
            render: (t) => `${formatNumber(t.restated_count)} (${formatPercent(t.restated_pct, 1)})`,
          },
          {
            key: "versions",
            label: "Lease versions",
            align: "right",
            render: (t) => (t.merged ? `${formatNumber(t.versionCount)} (combined)` : "1"),
          },
        ]}
        rows={tenants}
        rowKey={(t) => t.tenant_id}
      />
    </div>
  );
}
