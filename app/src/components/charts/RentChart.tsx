/* Metric 3: rent owed per month, base and turnover kept apart.
 *
 * A stacked column per month, not a line and not a single total bar. The
 * two components answer different questions and a landlord acts on them
 * differently: base rent is contracted and does not move, turnover rent is
 * the part that only exists when a tenant clears its threshold, so it
 * tracks the season. Stacking gives the total at the top of the column
 * while keeping the moving part readable at the bottom, which is the one
 * arrangement that answers both questions at once.
 *
 * Stacked is defensible here specifically because the parts sum to
 * something real. Total rent owed is a genuine figure a GM invoices,
 * unlike the stacked charts that add up quantities nobody would ever add.
 */

import { useState } from "react";
import { barPath, domainFrom, niceTicks, scaleLinear } from "../../lib/chart";
import { formatCurrency, formatMonthLong, formatMonthShort, formatNumber } from "../../lib/format";
import type { RentMonth } from "../../lib/leasing";
import { TableView } from "./TableView";

const W = 900;
const H = 300;
const PAD_L = 78;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 42;

export function RentChart({ months, currency }: { months: RentMonth[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);

  if (months.length === 0) {
    return <p className="chart__empty">No tenant submissions in the selected range.</p>;
  }

  const domain = domainFrom(months.map((m) => m.totalOwed));
  const y = scaleLinear(domain, [H - PAD_B, PAD_T]);
  const ticks = niceTicks(domain[0], domain[1], 4);

  const plotWidth = W - PAD_L - PAD_R;
  const slot = plotWidth / months.length;
  // Thin marks: the column takes a little over half its slot, so the gaps
  // read as separation rather than the bars reading as a solid block.
  const barWidth = Math.max(4, Math.min(28, slot * 0.62));
  const zero = y(0);

  const active = hover === null ? null : months[hover];

  const series = [
    { slot: "1", label: "Base rent", key: "baseRent" as const },
    { slot: "4", label: "Turnover rent", key: "turnoverRent" as const },
  ];

  return (
    <div className="chart">
      <div className="chart__legend">
        {series.map((s) => (
          <span className="chart__key" key={s.key}>
            <span className="chart__swatch" data-series={s.slot} />
            {s.label}
          </span>
        ))}
      </div>

      <div className="chart__figure">
        {active ? (
          <div
            className="chart__tooltip"
            style={
              // Flips to the left of the plot once the pointer passes the
              // midpoint, so the panel never runs off the right edge on
              // the last months of a range.
              hover !== null && hover > months.length / 2 ? { left: 12 } : { right: 12 }
            }
          >
            <strong>{formatMonthLong(active.month_start)}</strong>
            <div className="chart__tooltip-row">
              <span>Base rent</span>
              <span>{formatCurrency(active.baseRent, currency)}</span>
            </div>
            <div className="chart__tooltip-row">
              <span>Turnover rent</span>
              <span>{formatCurrency(active.turnoverRent, currency)}</span>
            </div>
            <div className="chart__tooltip-row">
              <span>Total owed</span>
              <span>{formatCurrency(active.totalOwed, currency)}</span>
            </div>
            <p className="chart__tooltip-meta">
              {formatNumber(active.tenantCount)} tenants reporting
            </p>
          </div>
        ) : null}

        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Rent owed per month, base rent and turnover rent stacked"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart__grid" x1={PAD_L} x2={W - PAD_R} y1={y(tick)} y2={y(tick)} />
              <text className="chart__tick" x={PAD_L - 8} y={y(tick) + 4} textAnchor="end">
                {formatNumber(tick)}
              </text>
            </g>
          ))}

          {months.map((month, index) => {
            const x = PAD_L + index * slot + (slot - barWidth) / 2;
            const turnoverTop = y(month.turnoverRent);
            const totalTop = y(month.totalOwed);
            return (
              <g
                key={month.month_start}
                onPointerEnter={() => setHover(index)}
                onPointerLeave={() => setHover(null)}
              >
                <rect className="chart__hit" x={PAD_L + index * slot} y={PAD_T} width={slot} height={H - PAD_T - PAD_B} />

                {/* Turnover sits at the baseline and base rent stacks on
                    top of it, which is the reverse of the legend order and
                    deliberate: the moving component is the one worth
                    reading precisely, and only a segment anchored to the
                    axis can be read against it. A segment floating on top
                    of a 10,000 KWD base can only be judged by its height. */}
                <path
                  className="chart__bar"
                  data-series="4"
                  data-dim={hover !== null && hover !== index ? "true" : undefined}
                  d={barPath(x, turnoverTop, barWidth, zero - turnoverTop, 0, "top")}
                />
                {/* 2px of surface between the two segments, per the mark
                    spec: the gap does the separating, never a stroke. */}
                <path
                  className="chart__bar"
                  data-series="1"
                  data-dim={hover !== null && hover !== index ? "true" : undefined}
                  d={barPath(x, totalTop, barWidth, turnoverTop - totalTop - 2, 4, "top")}
                />
              </g>
            );
          })}

          {/* Every third month, so the labels never collide at 24 months
              and never look sparse at 6. */}
          {months.map((month, index) =>
            index % Math.ceil(months.length / 8) === 0 ? (
              <text
                key={month.month_start}
                className="chart__tick"
                x={PAD_L + index * slot + slot / 2}
                y={H - 22}
                textAnchor="middle"
              >
                {formatMonthShort(month.month_start)}
              </text>
            ) : null,
          )}

          <line className="chart__axis" x1={PAD_L} x2={W - PAD_R} y1={zero} y2={zero} />
          <text className="chart__panel-title" x={PAD_L} y={H - 6}>
            Rent owed, {currency} per month
          </text>
        </svg>
      </div>

      <TableView
        label="Table view: rent owed by month"
        caption="Owed under the lease terms in dim_tenant against the current-version submission. There is no payments source in this project, so there is no collected figure to compare against."
        columns={[
          { key: "month", label: "Month", render: (m: RentMonth) => formatMonthLong(m.month_start) },
          {
            key: "tenants",
            label: "Tenants",
            align: "right",
            render: (m) => formatNumber(m.tenantCount),
          },
          {
            key: "base",
            label: `Base rent ${currency}`,
            align: "right",
            render: (m) => formatCurrency(m.baseRent, currency),
          },
          {
            key: "turnover",
            label: `Turnover rent ${currency}`,
            align: "right",
            render: (m) => formatCurrency(m.turnoverRent, currency),
          },
          {
            key: "total",
            label: `Total owed ${currency}`,
            align: "right",
            render: (m) => formatCurrency(m.totalOwed, currency),
          },
        ]}
        rows={months}
        rowKey={(m) => m.month_start}
      />
    </div>
  );
}
