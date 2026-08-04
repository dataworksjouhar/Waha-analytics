/* Metric 12: stable occupancy against the fixed box inventory.
 *
 * Like the lesson chart, this is a capacity measure, so it gets a real
 * ceiling rather than an axis that stretches to fit. The denominator here
 * is genuinely fixed: dim_stable holds twenty boxes and you cannot board
 * a twenty-first horse, so the distance between the line and the ceiling
 * is unsold inventory in the most literal sense in this whole dashboard.
 *
 * Columns rather than a line, because at twenty boxes the measure is
 * discrete: it moves in fifths of a box-percent and a smooth line would
 * imply a continuity the thing does not have.
 */

import { useState } from "react";
import { barPath, scaleLinear } from "../../lib/chart";
import { formatCurrency, formatMonthLong, formatMonthShort, formatNumber, formatPercent } from "../../lib/format";
import type { StableMonth } from "../../lib/recurring";
import { TableView } from "./TableView";

const W = 900;
const H = 240;
const PAD_L = 40;
const PAD_R = 12;
const PAD_T = 20;
const PAD_B = 44;

export function OccupancyChart({
  months,
  currency,
}: {
  months: StableMonth[];
  currency: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (months.length === 0) {
    return <p className="chart__empty">No boarding contracts in the selected range.</p>;
  }

  const totalBoxes = Math.max(...months.map((m) => m.total_boxes));
  // Domain is the inventory, not the data. A month where 19 of 20 boxes
  // are full must not fill the plot.
  const y = scaleLinear([0, totalBoxes], [H - PAD_B, PAD_T]);
  const slot = (W - PAD_L - PAD_R) / months.length;
  const barWidth = Math.max(4, Math.min(28, slot * 0.62));
  const zero = y(0);

  const active = hover === null ? null : months[hover];

  return (
    <div className="chart">
      <div className="chart__legend">
        <span className="chart__key">
          <span className="chart__swatch" data-series="7" />
          Occupied boxes
        </span>
        <span className="chart__key">
          <span className="chart__swatch chart__swatch--rule" />
          {formatNumber(totalBoxes)} boxes built
        </span>
      </div>

      <div className="chart__figure">
        {active ? (
          <div
            className="chart__tooltip"
            style={hover !== null && hover > months.length / 2 ? { left: 12 } : { right: 12 }}
          >
            <strong>{formatMonthLong(active.month_start)}</strong>
            <div className="chart__tooltip-row">
              <span>Occupied</span>
              <span>
                {formatNumber(active.occupied_boxes)} of {formatNumber(active.total_boxes)}
              </span>
            </div>
            <div className="chart__tooltip-row">
              <span>Occupancy</span>
              <span>{formatPercent(active.occupancy_pct, 0)}</span>
            </div>
            <div className="chart__tooltip-row">
              <span>Boarding revenue</span>
              <span>{formatCurrency(active.boarding_revenue_kwd, currency)}</span>
            </div>
          </div>
        ) : null}

        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Occupied stable boxes per month against total inventory"
        >
          {Array.from({ length: totalBoxes / 5 + 1 }, (_, i) => i * 5).map((tick) => (
            <g key={tick}>
              <line className="chart__grid" x1={PAD_L} x2={W - PAD_R} y1={y(tick)} y2={y(tick)} />
              <text className="chart__tick" x={PAD_L - 8} y={y(tick) + 4} textAnchor="end">
                {tick}
              </text>
            </g>
          ))}

          <line
            className="chart__rule"
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(totalBoxes)}
            y2={y(totalBoxes)}
          />
          <text className="chart__annotation" x={PAD_L + 4} y={y(totalBoxes) - 5}>
            Every box full
          </text>

          {months.map((month, index) => {
            const x = PAD_L + index * slot + (slot - barWidth) / 2;
            const top = y(month.occupied_boxes);
            return (
              <g
                key={month.month_start}
                onPointerEnter={() => setHover(index)}
                onPointerLeave={() => setHover(null)}
              >
                <rect
                  className="chart__hit"
                  x={PAD_L + index * slot}
                  y={PAD_T}
                  width={slot}
                  height={H - PAD_T - PAD_B}
                />
                <path
                  className="chart__bar"
                  data-series="7"
                  data-dim={hover !== null && hover !== index ? "true" : undefined}
                  d={barPath(x, top, barWidth, zero - top, 4, "top")}
                />
              </g>
            );
          })}

          {months.map((month, index) =>
            index % Math.ceil(months.length / 8) === 0 ? (
              <text
                key={month.month_start}
                className="chart__tick"
                x={PAD_L + index * slot + slot / 2}
                y={H - PAD_B + 20}
                textAnchor="middle"
              >
                {formatMonthShort(month.month_start)}
              </text>
            ) : null,
          )}

          <line className="chart__axis" x1={PAD_L} x2={W - PAD_R} y1={zero} y2={zero} />
          <text className="chart__panel-title" x={PAD_L} y={H - 6}>
            Boxes under an active boarding contract
          </text>
        </svg>
      </div>

      <TableView
        label="Table view: stable occupancy by month"
        caption="Occupied counts distinct boxes under an active boarding contract that month, against the fixed inventory in dim_stable. Boarding revenue is the MRR of those contracts, which is why it barely moves with the season: horses stay stabled whether or not anyone is riding."
        columns={[
          {
            key: "month",
            label: "Month",
            render: (m: StableMonth) => formatMonthLong(m.month_start),
          },
          {
            key: "occupied",
            label: "Occupied",
            align: "right",
            render: (m) => formatNumber(m.occupied_boxes),
          },
          {
            key: "empty",
            label: "Empty",
            align: "right",
            render: (m) => formatNumber(m.total_boxes - m.occupied_boxes),
          },
          {
            key: "pct",
            label: "Occupancy",
            align: "right",
            render: (m) => formatPercent(m.occupancy_pct, 0),
          },
          {
            key: "revenue",
            label: `Boarding revenue ${currency}`,
            align: "right",
            render: (m) => formatCurrency(m.boarding_revenue_kwd, currency),
          },
        ]}
        rows={months}
        rowKey={(m) => m.month_start}
      />
    </div>
  );
}
