/* Metric 9: the three revenue streams by month.
 *
 * Stacked columns, and the stack is legitimate: the three streams are
 * disjoint by construction, so the total is a real number the business
 * banks. Memberships and boarding live in fact_membership_months and
 * never appear as invoice lines in fact_pos_sales, which is the assertion
 * that makes the addition honest and the first thing worth being able to
 * defend about this chart.
 *
 * Absolute money rather than a 100% stack. The interesting thing here is
 * that the streams behave differently through the year: own-venue trade
 * collapses in the Kuwaiti summer while membership MRR barely moves,
 * because horses stay stabled and gyms are indoors. Normalising to
 * percentages would show the mix shifting and hide that total revenue
 * halves, which is the fact a GM staffs against.
 *
 * A partial month is drawn hatched rather than dropped. The last bucket
 * holds one day of till receipts against a full month's membership
 * snapshot, so its mix is an artifact of where the data was cut.
 */

import { useState } from "react";
import { barPath, domainFrom, niceTicks, scaleLinear } from "../../lib/chart";
import { formatCurrency, formatMonthLong, formatMonthShort, formatPercent } from "../../lib/format";
import type { RevenueMonth } from "../../lib/recurring";
import { TableView } from "./TableView";

const W = 900;
const H = 320;
const PAD_L = 66;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 46;

const STREAMS = [
  { key: "own_venue_revenue_kwd", slot: "1", label: "Own venues" },
  { key: "rental_revenue_kwd", slot: "4", label: "Tenant rent" },
  { key: "membership_mrr_kwd", slot: "3", label: "Membership and boarding" },
] as const;

export function RevenueMixChart({
  months,
  partialMonths,
  currency,
}: {
  months: RevenueMonth[];
  partialMonths: Set<string>;
  currency: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (months.length === 0) {
    return <p className="chart__empty">No revenue in the selected range.</p>;
  }

  const domain = domainFrom(months.map((m) => m.total_revenue_kwd));
  const y = scaleLinear(domain, [H - PAD_B, PAD_T]);
  const ticks = niceTicks(domain[0], domain[1], 4);
  const slot = (W - PAD_L - PAD_R) / months.length;
  const barWidth = Math.max(4, Math.min(30, slot * 0.62));
  const zero = y(0);

  const active = hover === null ? null : months[hover];
  const activePartial = active ? partialMonths.has(active.month_start) : false;

  return (
    <div className="chart">
      <div className="chart__legend">
        {STREAMS.map((stream) => (
          <span className="chart__key" key={stream.key}>
            <span className="chart__swatch" data-series={stream.slot} />
            {stream.label}
          </span>
        ))}
        {partialMonths.size > 0 ? (
          <span className="chart__key">
            <span className="chart__swatch chart__swatch--hatched" />
            Partial month
          </span>
        ) : null}
      </div>

      <div className="chart__figure">
        {active ? (
          <div
            className="chart__tooltip"
            style={hover !== null && hover > months.length / 2 ? { left: 12 } : { right: 12 }}
          >
            <strong>{formatMonthLong(active.month_start)}</strong>
            {STREAMS.map((stream) => {
              const value = active[stream.key] ?? 0;
              return (
                <div className="chart__tooltip-row" key={stream.key}>
                  <span>
                    <span className="chart__swatch chart__swatch--dot" data-series={stream.slot} />{" "}
                    {stream.label}
                  </span>
                  <span>
                    {formatCurrency(value, currency)}{" "}
                    <span className="chart__tooltip-share">
                      {formatPercent(
                        active.total_revenue_kwd > 0
                          ? (value / active.total_revenue_kwd) * 100
                          : null,
                        0,
                      )}
                    </span>
                  </span>
                </div>
              );
            })}
            <div className="chart__tooltip-row">
              <span>Total</span>
              <span>{formatCurrency(active.total_revenue_kwd, currency)}</span>
            </div>
            {activePartial ? (
              <p className="chart__tooltip-meta">
                Partial month: the till has days missing but the membership snapshot is whole, so
                the mix is not comparable.
              </p>
            ) : null}
          </div>
        ) : null}

        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Monthly revenue by stream: own venues, tenant rent, membership and boarding"
        >
          <defs>
            {/* Hatching rather than a colour, so a partial month reads as
                "not a normal bar" in greyscale, in print, and to a reader
                who cannot separate the hues. */}
            <pattern
              id="partial-hatch"
              width="5"
              height="5"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <line x1="0" y1="0" x2="0" y2="5" className="chart__hatch-line" />
            </pattern>
          </defs>

          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart__grid" x1={PAD_L} x2={W - PAD_R} y1={y(tick)} y2={y(tick)} />
              <text className="chart__tick" x={PAD_L - 8} y={y(tick) + 4} textAnchor="end">
                {formatCurrency(tick, currency)}
              </text>
            </g>
          ))}

          {months.map((month, index) => {
            const x = PAD_L + index * slot + (slot - barWidth) / 2;
            const partial = partialMonths.has(month.month_start);
            let cursorY = zero;

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
                {STREAMS.map((stream, streamIndex) => {
                  const value = month[stream.key] ?? 0;
                  if (value <= 0) return null;
                  const height = zero - y(value);
                  const top = cursorY - height;
                  cursorY = top;
                  // 2px of surface between segments, and the rounded cap
                  // only on the topmost one so the stack still reads as a
                  // single column standing on the axis.
                  const isTop = streamIndex === STREAMS.length - 1;
                  return (
                    <g key={stream.key}>
                      <path
                        className="chart__bar"
                        data-series={stream.slot}
                        data-dim={hover !== null && hover !== index ? "true" : undefined}
                        d={barPath(x, top, barWidth, height - 2, isTop ? 4 : 0, "top")}
                      />
                      {partial ? (
                        <path
                          className="chart__bar-hatch"
                          d={barPath(x, top, barWidth, height - 2, isTop ? 4 : 0, "top")}
                        />
                      ) : null}
                    </g>
                  );
                })}
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
            Revenue by stream, {currency} per month
          </text>
        </svg>
      </div>

      <TableView
        label="Table view: revenue by stream and month"
        caption="The three streams are disjoint: memberships and boarding are contracts in fact_membership_months and never appear as invoice lines in fact_pos_sales, so the total is not double counted. Partial months are marked; their mix reflects where the data was cut, not how the business traded."
        columns={[
          {
            key: "month",
            label: "Month",
            render: (m: RevenueMonth) =>
              `${formatMonthLong(m.month_start)}${partialMonths.has(m.month_start) ? " (partial)" : ""}`,
          },
          {
            key: "own",
            label: `Own venues ${currency}`,
            align: "right",
            render: (m) => formatCurrency(m.own_venue_revenue_kwd, currency),
          },
          {
            key: "rent",
            label: `Tenant rent ${currency}`,
            align: "right",
            render: (m) => formatCurrency(m.rental_revenue_kwd, currency),
          },
          {
            key: "mrr",
            label: `Membership ${currency}`,
            align: "right",
            render: (m) => formatCurrency(m.membership_mrr_kwd, currency),
          },
          {
            key: "total",
            label: `Total ${currency}`,
            align: "right",
            render: (m) => formatCurrency(m.total_revenue_kwd, currency),
          },
          {
            key: "share",
            label: "Recurring share",
            align: "right",
            render: (m) =>
              formatPercent(
                m.total_revenue_kwd > 0
                  ? ((m.membership_mrr_kwd ?? 0) / m.total_revenue_kwd) * 100
                  : null,
                0,
              ),
          },
        ]}
        rows={months}
        rowKey={(m) => m.month_start}
      />
    </div>
  );
}
