/* Metric 8: the active membership base by contract type.
 *
 * Four lines on one plot rather than a stack. The question here is how
 * each recurring stream is trending on its own, and a stacked area would
 * make three of the four impossible to read: only the bottom band sits on
 * a flat baseline, and horse boarding at 19 contracts would be an
 * invisible sliver riding on top of 605 gym members.
 *
 * A log axis would fit them all comfortably and is exactly the wrong
 * answer: it would make a stable 19 and a growing 605 look like
 * comparable trends. The scale stays linear and the small series stay
 * small, which is the truth about them. Their detail is in the tiles, the
 * tooltip and the table.
 *
 * Churn is deliberately not a second line on this chart. It is a rate on
 * a completely different scale, and putting it here would need a second
 * y-axis, which this dashboard does not do anywhere.
 */

import { useMemo, useState } from "react";
import { domainFrom, linePath, nearestIndex, niceTicks, scaleLinear } from "../../lib/chart";
import { formatCurrency, formatMonthShort, formatNumber, formatPercent } from "../../lib/format";
import { prettyContract, type MembershipSeries } from "../../lib/recurring";
import { TableView } from "./TableView";

const W = 900;
const H = 300;
const PAD_L = 46;
const PAD_R = 118;
const PAD_T = 16;
const PAD_B = 46;

export function MembershipChart({
  series,
  currency,
}: {
  series: MembershipSeries[];
  currency: string;
}) {
  const [cursor, setCursor] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const months = series.reduce<{ key: number; start: string }[]>((longest, s) => {
      const keys = s.points.map((p) => ({ key: p.month_date_key, start: p.month_start }));
      return keys.length > longest.length ? keys : longest;
    }, []);

    const x = scaleLinear([0, Math.max(months.length - 1, 1)], [PAD_L, W - PAD_R]);
    const domain = domainFrom(series.flatMap((s) => s.points.map((p) => p.active_count)));
    const y = scaleLinear(domain, [H - PAD_B, PAD_T]);

    return { months, x, y, xs: months.map((_, i) => x(i)), ticks: niceTicks(domain[0], domain[1], 5) };
  }, [series]);

  if (series.length === 0 || geometry.months.length === 0) {
    return <p className="chart__empty">No contracts in the selected range.</p>;
  }

  const { months, x, y, xs, ticks } = geometry;

  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const userX = ((event.clientX - rect.left) / rect.width) * W;
    setCursor(nearestIndex(xs, userX));
  };

  return (
    <div className="chart">
      <div className="chart__legend">
        {series.map((s) => (
          <span className="chart__key" key={s.contract_type}>
            <span className="chart__swatch chart__swatch--line" data-series={s.slot} />
            {prettyContract(s.contract_type)}
          </span>
        ))}
      </div>

      <div className="chart__figure">
        {cursor !== null ? (
          <div
            className="chart__tooltip"
            style={cursor > months.length / 2 ? { left: 12 } : { right: 12 }}
          >
            <strong>{formatMonthShort(months[cursor].start)}</strong>
            {series.map((s) => {
              const point = s.points.find((p) => p.month_date_key === months[cursor].key);
              return (
                <div className="chart__tooltip-row" key={s.contract_type}>
                  <span>
                    <span className="chart__swatch chart__swatch--dot" data-series={s.slot} />{" "}
                    {prettyContract(s.contract_type)}
                  </span>
                  <span>
                    {point ? formatNumber(point.active_count) : "-"}
                    {point ? (
                      <span className="chart__tooltip-share">
                        {" "}
                        +{formatNumber(point.new_count)} / -{formatNumber(point.churned_count)}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
            <p className="chart__tooltip-meta">active, then joined and left that month</p>
          </div>
        ) : null}

        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Active contracts by type and month"
          onPointerMove={handlePointer}
          onPointerLeave={() => setCursor(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart__grid" x1={PAD_L} x2={W - PAD_R} y1={y(tick)} y2={y(tick)} />
              <text className="chart__tick" x={PAD_L - 8} y={y(tick) + 4} textAnchor="end">
                {formatNumber(tick)}
              </text>
            </g>
          ))}

          {series.map((s) => (
            <path
              key={s.contract_type}
              className="chart__line"
              data-series={s.slot}
              d={linePath(
                months.map((month, index) => {
                  const point = s.points.find((p) => p.month_date_key === month.key);
                  return { x: x(index), y: point ? y(point.active_count) : null };
                }),
              )}
            />
          ))}

          {(() => {
            const ends = series
              .map((s) => {
                const last = s.points[s.points.length - 1];
                return last ? { s, value: last.active_count } : null;
              })
              .filter((e): e is { s: MembershipSeries; value: number } => e !== null)
              .sort((a, b) => b.value - a.value);

            let previousY = -Infinity;
            return ends.map(({ s, value }) => {
              const placed = Math.max(y(value), previousY + 14);
              previousY = placed;
              return (
                <text
                  key={s.contract_type}
                  className="chart__end-label"
                  x={W - PAD_R + 10}
                  y={placed + 4}
                >
                  {prettyContract(s.contract_type)} {formatNumber(value)}
                </text>
              );
            });
          })()}

          {cursor !== null ? (
            <g className="chart__cursor">
              <line x1={xs[cursor]} x2={xs[cursor]} y1={PAD_T} y2={H - PAD_B} />
              {series.map((s) => {
                const point = s.points.find((p) => p.month_date_key === months[cursor].key);
                if (!point) return null;
                return (
                  <circle
                    key={s.contract_type}
                    data-series={s.slot}
                    cx={xs[cursor]}
                    cy={y(point.active_count)}
                    r={4}
                  />
                );
              })}
            </g>
          ) : null}

          {months.map((month, index) =>
            index % Math.ceil(months.length / 8) === 0 ? (
              <text
                key={month.key}
                className="chart__tick"
                x={x(index)}
                y={H - PAD_B + 20}
                textAnchor="middle"
              >
                {formatMonthShort(month.start)}
              </text>
            ) : null,
          )}

          <line className="chart__axis" x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} />
          <text className="chart__panel-title" x={PAD_L} y={H - 6}>
            Active contracts
          </text>
        </svg>
      </div>

      <TableView
        label="Table view: membership base and churn"
        caption="Churn is total leavers over total exposed base across the range, not a mean of the monthly rates: a month with 600 members must not count the same as a month with 19. The first month of the history has no churn rate because there is no prior month to divide by, which is a different fact from nobody leaving."
        columns={[
          {
            key: "type",
            label: "Contract type",
            render: (s: MembershipSeries) => prettyContract(s.contract_type),
          },
          {
            key: "active",
            label: "Active now",
            align: "right",
            render: (s) => formatNumber(s.latestActive),
          },
          {
            key: "net",
            label: "Net change",
            align: "right",
            render: (s) => `${s.netChange > 0 ? "+" : ""}${formatNumber(s.netChange)}`,
          },
          {
            key: "mrr",
            label: `MRR ${currency}`,
            align: "right",
            render: (s) => formatCurrency(s.latestMrr, currency),
          },
          {
            key: "churn",
            label: "Monthly churn",
            align: "right",
            render: (s) => formatPercent(s.churnPct, 2),
          },
        ]}
        rows={series}
        rowKey={(s) => s.contract_type}
      />
    </div>
  );
}
