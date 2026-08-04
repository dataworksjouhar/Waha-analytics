/* Metric 1: daily footfall against the same day a year ago, with weather
 * underneath.
 *
 * Weather sits in its OWN panel sharing the x-axis, never as a second
 * y-axis on the footfall plot. A dual-axis chart lets you slide two
 * unrelated scales until they appear to move together, which invents a
 * correlation the data does not contain. Stacked panels make the reader
 * do the comparison honestly: same dates, two separate measures, and the
 * eye still reads "the hot months are the empty months" straight off the
 * page.
 *
 * The week-ago series in the view is deliberately not drawn. Three daily
 * lines over two years is a thicket, and week-ago is a comparison you
 * want for a specific day rather than as a shape; it lives in the tooltip
 * and the table instead.
 */

import { useMemo, useState } from "react";
import type { FootfallDay } from "../../lib/data";
import { formatNumber } from "../../lib/format";
import { domainFrom, linePath, nearestIndex, niceTicks, scaleLinear } from "../../lib/chart";
import { TableView } from "./TableView";

const W = 900;
const PAD_L = 58;
const PAD_R = 18;
const FOOT_TOP = 14;
const FOOT_H = 210;
const WEATHER_TOP = 268;
const WEATHER_H = 74;
const AXIS_Y = WEATHER_TOP + WEATHER_H + 22;
const H = AXIS_Y + 14;

export function FootfallTimeline({ days }: { days: FootfallDay[] }) {
  const [cursor, setCursor] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const x = scaleLinear([0, Math.max(days.length - 1, 1)], [PAD_L, W - PAD_R]);

    const footDomain = domainFrom([
      ...days.map((d) => d.footfall),
      ...days.map((d) => d.footfall_year_ago).filter((v): v is number => v !== null),
    ]);
    const footY = scaleLinear(footDomain, [FOOT_TOP + FOOT_H, FOOT_TOP]);

    const temps = days.map((d) => d.temp_max_c).filter((v): v is number => v !== null);
    // includeZero false: Kuwait's max never approaches 0C, so anchoring
    // this axis at zero would squash the whole series into the top third
    // and hide the very swing the panel exists to show.
    const tempDomain = domainFrom(temps, false);
    const tempY = scaleLinear(tempDomain, [WEATHER_TOP + WEATHER_H, WEATHER_TOP]);

    const xs = days.map((_, i) => x(i));

    return {
      x,
      xs,
      footY,
      tempY,
      footTicks: niceTicks(footDomain[0], footDomain[1], 4),
      tempTicks: niceTicks(tempDomain[0], tempDomain[1], 3),
      nowPath: linePath(days.map((d, i) => ({ x: xs[i], y: footY(d.footfall) }))),
      yearAgoPath: linePath(
        days.map((d, i) => ({
          x: xs[i],
          y: d.footfall_year_ago === null ? null : footY(d.footfall_year_ago),
        })),
      ),
      tempPath: linePath(
        days.map((d, i) => ({ x: xs[i], y: d.temp_max_c === null ? null : tempY(d.temp_max_c) })),
      ),
      // Month starts, thinned so labels never collide: with two years on
      // screen every month would overprint its neighbour.
      monthTicks: days
        .map((d, i) => ({ date: d.full_date, i }))
        .filter(({ date }) => date.endsWith("-01"))
        .filter((_, n, all) => all.length <= 12 || n % Math.ceil(all.length / 12) === 0),
      dustDays: days.map((d, i) => ({ day: d, i })).filter(({ day }) => day.dust_storm_flag),
      busiest: days.reduce(
        (best, d, i) => (best === null || d.footfall > days[best].footfall ? i : best),
        null as number | null,
      ),
    };
  }, [days]);

  if (days.length === 0) {
    return <p className="chart__empty">No footfall in the selected range.</p>;
  }

  const active = cursor !== null && cursor >= 0 && cursor < days.length ? days[cursor] : null;

  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // The SVG scales to its container, so a client pixel is not a user
    // unit. Convert through the rendered width before hit-testing.
    const userX = ((event.clientX - rect.left) / rect.width) * W;
    setCursor(nearestIndex(geometry.xs, userX));
  };

  const handleKey = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    const from = cursor ?? (geometry.busiest ?? 0);
    setCursor(Math.min(days.length - 1, Math.max(0, from + step)));
  };

  return (
    <div className="chart">
      <div className="chart__legend">
        <span className="chart__key">
          <span className="chart__swatch chart__swatch--line" data-series="1" />
          Footfall
        </span>
        <span className="chart__key">
          <span className="chart__swatch chart__swatch--line" data-series="2" />
          Same day a year ago
        </span>
        <span className="chart__key">
          <span className="chart__swatch chart__swatch--rug" />
          Dust storm day
        </span>
      </div>

      <div className="chart__figure">
        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Daily footfall for ${days.length} days, with maximum temperature below. Use left and right arrow keys to step through days.`}
          tabIndex={0}
          onPointerMove={handlePointer}
          onPointerLeave={() => setCursor(null)}
          onKeyDown={handleKey}
        >
          {/* Dust storm days as a rug beneath the plot, not as full-height
              bands through it. Drawn across the plot they read as data
              marks, and a cluster of them in a dusty spring looks like a
              spike in the series they are only context for. Below the
              baseline they stay legible as annotation. */}
          {geometry.dustDays.map(({ i }) => (
            <rect
              key={`dust-${i}`}
              className="chart__rug"
              x={geometry.xs[i] - 1}
              y={FOOT_TOP + FOOT_H + 8}
              width={2}
              height={6}
            />
          ))}

          {geometry.footTicks.map((tick) => (
            <g key={`fy-${tick}`}>
              <line
                className="chart__grid"
                x1={PAD_L}
                x2={W - PAD_R}
                y1={geometry.footY(tick)}
                y2={geometry.footY(tick)}
              />
              <text className="chart__tick" x={PAD_L - 8} y={geometry.footY(tick) + 4} textAnchor="end">
                {formatNumber(tick)}
              </text>
            </g>
          ))}

          <path className="chart__line" d={geometry.yearAgoPath} data-series="2" />
          <path className="chart__line" d={geometry.nowPath} data-series="1" />

          {/* One direct label, on the extreme. Labelling more points on a
              731-day series would bury the shape it exists to show. */}
          {geometry.busiest !== null ? (
            <g>
              <circle
                className="chart__marker"
                cx={geometry.xs[geometry.busiest]}
                cy={geometry.footY(days[geometry.busiest].footfall)}
                r={4}
                data-series="1"
              />
              <text
                className="chart__annotation"
                x={geometry.xs[geometry.busiest]}
                y={geometry.footY(days[geometry.busiest].footfall) - 12}
                textAnchor={geometry.busiest > days.length * 0.75 ? "end" : "middle"}
              >
                busiest {formatNumber(days[geometry.busiest].footfall)}
              </text>
            </g>
          ) : null}

          <text className="chart__panel-title" x={PAD_L} y={WEATHER_TOP - 12}>
            Maximum temperature (C)
          </text>

          {geometry.tempTicks.map((tick) => (
            <g key={`ty-${tick}`}>
              <line
                className="chart__grid"
                x1={PAD_L}
                x2={W - PAD_R}
                y1={geometry.tempY(tick)}
                y2={geometry.tempY(tick)}
              />
              <text className="chart__tick" x={PAD_L - 8} y={geometry.tempY(tick) + 4} textAnchor="end">
                {formatNumber(tick)}
              </text>
            </g>
          ))}

          <path className="chart__line" d={geometry.tempPath} data-series="4" />

          <line className="chart__axis" x1={PAD_L} x2={W - PAD_R} y1={AXIS_Y - 14} y2={AXIS_Y - 14} />
          {geometry.monthTicks.map(({ date, i }) => (
            <text key={date} className="chart__tick" x={geometry.xs[i]} y={AXIS_Y} textAnchor="middle">
              {date.slice(0, 7)}
            </text>
          ))}

          {active && cursor !== null ? (
            <g className="chart__cursor">
              <line x1={geometry.xs[cursor]} x2={geometry.xs[cursor]} y1={FOOT_TOP} y2={WEATHER_TOP + WEATHER_H} />
              <circle
                cx={geometry.xs[cursor]}
                cy={geometry.footY(active.footfall)}
                r={4}
                data-series="1"
              />
              {active.temp_max_c !== null ? (
                <circle
                  cx={geometry.xs[cursor]}
                  cy={geometry.tempY(active.temp_max_c)}
                  r={4}
                  data-series="4"
                />
              ) : null}
            </g>
          ) : null}
        </svg>

        {active && cursor !== null ? (
          <div
            className="chart__tooltip"
            style={{
              left: `${(geometry.xs[cursor] / W) * 100}%`,
              transform: geometry.xs[cursor] > W * 0.6 ? "translateX(-100%)" : undefined,
            }}
          >
            <strong>{active.full_date}</strong>
            <div className="chart__tooltip-row">
              <span>Footfall</span>
              <span>{formatNumber(active.footfall)}</span>
            </div>
            <div className="chart__tooltip-row">
              <span>Week ago</span>
              <span>{formatNumber(active.footfall_week_ago)}</span>
            </div>
            <div className="chart__tooltip-row">
              <span>Year ago</span>
              <span>{formatNumber(active.footfall_year_ago)}</span>
            </div>
            <div className="chart__tooltip-row">
              <span>Max temp</span>
              <span>{active.temp_max_c === null ? "-" : `${formatNumber(active.temp_max_c, 1)} C`}</span>
            </div>
            <div className="chart__tooltip-meta">
              {active.season.replace("_", " ")}
              {active.is_weekend ? " . weekend" : ""}
              {active.is_ramadan ? " . Ramadan" : ""}
              {active.dust_storm_flag ? " . dust storm" : ""}
              {active.has_imputed_hours ? " . imputed hours" : ""}
              {active.has_corrected_hours ? " . outlier corrected" : ""}
            </div>
          </div>
        ) : null}
      </div>

      <TableView
        label={`Table view: daily footfall (${days.length} days)`}
        columns={[
          { key: "date", label: "Date", render: (d: FootfallDay) => d.full_date },
          { key: "footfall", label: "Footfall", align: "right", render: (d) => formatNumber(d.footfall) },
          { key: "week", label: "Week ago", align: "right", render: (d) => formatNumber(d.footfall_week_ago) },
          { key: "year", label: "Year ago", align: "right", render: (d) => formatNumber(d.footfall_year_ago) },
          { key: "temp", label: "Max temp C", align: "right", render: (d) => formatNumber(d.temp_max_c, 1) },
          {
            key: "flags",
            label: "Flags",
            render: (d) =>
              [
                d.dust_storm_flag ? "dust storm" : null,
                d.has_imputed_hours ? "imputed" : null,
                d.has_corrected_hours ? "corrected" : null,
              ]
                .filter(Boolean)
                .join(", ") || "-",
          },
        ]}
        rows={days}
        rowKey={(d) => d.full_date}
      />
    </div>
  );
}
