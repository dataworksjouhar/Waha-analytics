/* Metric 11: riding lesson slot utilization by level, month by month.
 *
 * A capacity chart, so it gets a fixed 0 to 100 axis and a marked
 * ceiling. Auto-scaling this to the data would be actively misleading:
 * a level running at 53% would fill the plot height and look healthy,
 * and the whole question here is distance from full.
 *
 * The 100% line is drawn as a real limit rather than an axis maximum,
 * because the beginner series crosses it. That is not an error in the
 * chart: a slot can be booked beyond its capacity, the pipeline flags it
 * rather than clamping it, and a line poking above the ceiling is a more
 * honest picture of a school turning people away than a line pinned
 * neatly at 100.
 */

import { useMemo, useState } from "react";
import { domainFrom, linePath, nearestIndex, niceTicks, scaleLinear } from "../../lib/chart";
import { formatMonthShort, formatNumber, formatPercent } from "../../lib/format";
import type { LevelSeries } from "../../lib/recurring";
import { TableView } from "./TableView";

const W = 900;
const H = 320;
const PAD_L = 44;
const PAD_R = 104;
const PAD_T = 18;
const PAD_B = 46;
const CEILING = 100;

export function UtilizationChart({ levels }: { levels: LevelSeries[] }) {
  const [cursor, setCursor] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const months = levels.reduce<{ key: number; start: string }[]>((longest, level) => {
      const keys = level.points.map((p) => ({ key: p.month_key, start: p.month_start }));
      return keys.length > longest.length ? keys : longest;
    }, []);

    const x = scaleLinear([0, Math.max(months.length - 1, 1)], [PAD_L, W - PAD_R]);
    // Anchored at zero and reaching at least the ceiling, so the plot
    // always shows the full range a percentage can occupy plus whatever
    // overbooking pushes past it.
    const values = levels.flatMap((l) =>
      l.points.map((p) => p.utilizationPct).filter((v): v is number => v !== null),
    );
    const domain = domainFrom([0, CEILING, ...values]);
    const y = scaleLinear(domain, [H - PAD_B, PAD_T]);

    return { months, x, y, xs: months.map((_, i) => x(i)), ticks: niceTicks(domain[0], domain[1], 5) };
  }, [levels]);

  if (levels.length === 0 || geometry.months.length === 0) {
    return <p className="chart__empty">No lessons scheduled in the selected range.</p>;
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
        {levels.map((level) => (
          <span className="chart__key" key={level.level}>
            <span className="chart__swatch chart__swatch--line" data-series={level.slot} />
            {level.level}
          </span>
        ))}
        <span className="chart__key">
          <span className="chart__swatch chart__swatch--rule" />
          Capacity
        </span>
      </div>

      <div className="chart__figure">
        {cursor !== null ? (
          <div
            className="chart__tooltip"
            style={cursor > months.length / 2 ? { left: 12 } : { right: 12 }}
          >
            <strong>{formatMonthShort(months[cursor].start)}</strong>
            {levels.map((level) => {
              const point = level.points.find((p) => p.month_key === months[cursor].key);
              return (
                <div className="chart__tooltip-row" key={level.level}>
                  <span>
                    <span className="chart__swatch chart__swatch--dot" data-series={level.slot} />{" "}
                    {level.level}
                  </span>
                  <span>
                    {point ? formatPercent(point.utilizationPct, 0) : "-"}
                    {point ? ` (${formatNumber(point.booked)}/${formatNumber(point.capacity)})` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Riding lesson slot utilization by level and month, against capacity"
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

          {/* The ceiling. Drawn over the gridlines and under the series so
              a line crossing it stays legible. */}
          <line className="chart__rule" x1={PAD_L} x2={W - PAD_R} y1={y(CEILING)} y2={y(CEILING)} />
          <text className="chart__annotation" x={PAD_L + 4} y={y(CEILING) - 5}>
            Every seat sold
          </text>

          {levels.map((level) => (
            <path
              key={level.level}
              className="chart__line"
              data-series={level.slot}
              d={linePath(
                months.map((month, index) => {
                  const point = level.points.find((p) => p.month_key === month.key);
                  return {
                    x: x(index),
                    y: point?.utilizationPct != null ? y(point.utilizationPct) : null,
                  };
                }),
              )}
            />
          ))}

          {(() => {
            const ends = levels
              .map((level) => {
                const last = [...level.points].reverse().find((p) => p.utilizationPct !== null);
                return last ? { level, value: last.utilizationPct as number } : null;
              })
              .filter((e): e is { level: LevelSeries; value: number } => e !== null)
              .sort((a, b) => b.value - a.value);

            let previousY = -Infinity;
            return ends.map(({ level, value }) => {
              const placed = Math.max(y(value), previousY + 14);
              previousY = placed;
              return (
                <text
                  key={level.level}
                  className="chart__end-label"
                  x={W - PAD_R + 10}
                  y={placed + 4}
                >
                  {level.level} {formatPercent(Math.round(value), 0)}
                </text>
              );
            });
          })()}

          {cursor !== null ? (
            <g className="chart__cursor">
              <line x1={xs[cursor]} x2={xs[cursor]} y1={PAD_T} y2={H - PAD_B} />
              {levels.map((level) => {
                const point = level.points.find((p) => p.month_key === months[cursor].key);
                if (!point || point.utilizationPct === null) return null;
                return (
                  <circle
                    key={level.level}
                    data-series={level.slot}
                    cx={xs[cursor]}
                    cy={y(point.utilizationPct)}
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
            Seats booked as a share of seats offered
          </text>
        </svg>
      </div>

      <TableView
        label="Table view: lesson utilization by level"
        caption="Utilization over the range is total seats booked over total seats offered, not a mean of the monthly rates. Peak and trough are the best and worst single months, which is what says whether a gap is seasonal or structural. No-show excludes slots where the coach never marked attendance, counted separately rather than assumed full."
        columns={[
          { key: "level", label: "Level", render: (l: LevelSeries) => l.level },
          {
            key: "instructor",
            label: "Instructor",
            render: (l) => l.instructors.join(", ") || "-",
          },
          {
            key: "capacity",
            label: "Seats offered",
            align: "right",
            render: (l) => formatNumber(l.totalCapacity),
          },
          {
            key: "booked",
            label: "Seats booked",
            align: "right",
            render: (l) => formatNumber(l.totalBooked),
          },
          {
            key: "util",
            label: "Utilization",
            align: "right",
            render: (l) => formatPercent(l.overallPct, 1),
          },
          {
            key: "peak",
            label: "Best month",
            align: "right",
            render: (l) => formatPercent(l.peakPct, 0),
          },
          {
            key: "trough",
            label: "Worst month",
            align: "right",
            render: (l) => formatPercent(l.troughPct, 0),
          },
          {
            key: "noshow",
            label: "No-show",
            align: "right",
            render: (l) => formatPercent(l.noShowPct, 1),
          },
          {
            key: "flags",
            label: "Overbooked / unmarked",
            align: "right",
            render: (l) =>
              `${formatNumber(l.overbookedCount)} / ${formatNumber(l.missingAttendance)}`,
          },
        ]}
        rows={levels}
        rowKey={(l) => l.level}
      />
    </div>
  );
}
