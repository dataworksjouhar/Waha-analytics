/* Metric 6: website conversion by channel, month by month.
 *
 * The chart this section exists for. The whole-history view answers
 * "which channel converts best" and is drawn as tiles above; it cannot
 * answer "which channel is getting worse", because averaging two years
 * into one rate per channel removes the only axis that question lives on.
 *
 * Lines rather than bars: this is change over time across four series,
 * and the reader's job is to compare shapes, not to read any single
 * month's value precisely. The exact numbers are in the table.
 *
 * Every line is direct-labelled at its right end. With four series a
 * legend alone would make the reader look back and forth to tell orange
 * from green, and the two are the closest pair in the palette under
 * deuteranopia. The label at the end of the line removes the lookup
 * entirely and carries identity without colour.
 */

import { useMemo, useState } from "react";
import { domainFrom, linePath, nearestIndex, niceTicks, scaleLinear } from "../../lib/chart";
import { formatMonthShort, formatNumber, formatPercent } from "../../lib/format";
import type { ChannelSeries } from "../../lib/online";
import { TableView } from "./TableView";

const W = 900;
const H = 340;
const PAD_L = 46;
const PAD_R = 112;
const PAD_T = 16;
const PAD_B = 46;

export function ChannelTrendChart({ series }: { series: ChannelSeries[] }) {
  const [cursor, setCursor] = useState<number | null>(null);

  const geometry = useMemo(() => {
    // Every series shares one month axis. Taking the longest rather than
    // the first means a channel that started late still lands on the
    // right month rather than being shifted left onto the wrong dates.
    const months = series.reduce<number[]>((longest, s) => {
      const keys = s.points.map((p) => p.month_key);
      return keys.length > longest.length ? keys : longest;
    }, []);

    const x = scaleLinear([0, Math.max(months.length - 1, 1)], [PAD_L, W - PAD_R]);
    const rates = series.flatMap((s) =>
      s.points.filter((p) => !p.thin).map((p) => p.conversionPct).filter((v): v is number => v !== null),
    );
    const domain = domainFrom(rates);
    const y = scaleLinear(domain, [H - PAD_B, PAD_T]);

    return { months, x, y, xs: months.map((_, i) => x(i)), ticks: niceTicks(domain[0], domain[1], 5) };
  }, [series]);

  if (series.length === 0 || geometry.months.length === 0) {
    return <p className="chart__empty">No web sessions in the selected range.</p>;
  }

  const { months, x, y, xs, ticks } = geometry;

  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // Pointer position is converted into viewBox units before it is
    // compared with the plotted xs, so the crosshair stays correct at any
    // rendered width rather than only at the authored one.
    const userX = ((event.clientX - rect.left) / rect.width) * W;
    setCursor(nearestIndex(xs, userX));
  };

  const activeMonth = cursor === null ? null : months[cursor];

  return (
    <div className="chart">
      <div className="chart__legend">
        {series.map((s) => (
          <span className="chart__key" key={s.channel_name}>
            <span className="chart__swatch chart__swatch--line" data-series={s.slot} />
            {s.channel_name.replace(/_/g, " ")}
          </span>
        ))}
      </div>

      <div className="chart__figure">
        {activeMonth !== null ? (
          <div
            className="chart__tooltip"
            style={cursor !== null && cursor > months.length / 2 ? { left: 12 } : { right: 12 }}
          >
            <strong>
              {series[0].points.find((p) => p.month_key === activeMonth)?.month_start
                ? formatMonthShort(
                    series[0].points.find((p) => p.month_key === activeMonth)!.month_start!,
                  )
                : String(activeMonth)}
            </strong>
            {series.map((s) => {
              const point = s.points.find((p) => p.month_key === activeMonth);
              return (
                <div className="chart__tooltip-row" key={s.channel_name}>
                  <span>
                    <span className="chart__swatch chart__swatch--dot" data-series={s.slot} />{" "}
                    {s.channel_name.replace(/_/g, " ")}
                  </span>
                  <span>
                    {point?.conversionPct === null || point === undefined
                      ? "-"
                      : formatPercent(point.conversionPct, 2)}
                  </span>
                </div>
              );
            })}
            {series.some((s) => s.points.find((p) => p.month_key === activeMonth)?.thin) ? (
              <p className="chart__tooltip-meta">
                Partial month: too few sessions for the rate to be reliable.
              </p>
            ) : null}
          </div>
        ) : null}

        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Website conversion rate by channel, by month"
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

          {series.map((s) => {
            // Thin months break the line rather than bending it. A single
            // day's worth of sessions is not a month, and joining it to
            // the previous point would draw a slope the data never had.
            const points = months.map((key, index) => {
              const found = s.points.find((p) => p.month_key === key);
              return {
                x: x(index),
                y: found && !found.thin && found.conversionPct !== null ? y(found.conversionPct) : null,
              };
            });
            return (
              <path
                key={s.channel_name}
                className="chart__line"
                data-series={s.slot}
                d={linePath(points)}
              />
            );
          })}

          {/* Direct labels at the right end of each line, nudged apart so
              two channels finishing close together stay readable. */}
          {(() => {
            const ends = series
              .map((s) => {
                const last = [...s.points].reverse().find((p) => !p.thin && p.conversionPct !== null);
                return last ? { name: s.channel_name, slot: s.slot, value: last.conversionPct as number } : null;
              })
              .filter((e): e is { name: string; slot: string; value: number } => e !== null)
              .sort((a, b) => b.value - a.value);

            let previousY = -Infinity;
            return ends.map((end) => {
              const wanted = y(end.value);
              const placed = Math.max(wanted, previousY + 14);
              previousY = placed;
              return (
                <text
                  key={end.name}
                  className="chart__end-label"
                  data-series={end.slot}
                  x={W - PAD_R + 10}
                  y={placed + 4}
                >
                  {end.name.replace(/_/g, " ")} {formatPercent(end.value, 1)}
                </text>
              );
            });
          })()}

          {cursor !== null ? (
            <g className="chart__cursor">
              <line x1={xs[cursor]} x2={xs[cursor]} y1={PAD_T} y2={H - PAD_B} />
              {series.map((s) => {
                const point = s.points.find((p) => p.month_key === months[cursor]);
                if (!point || point.thin || point.conversionPct === null) return null;
                return (
                  <circle
                    key={s.channel_name}
                    data-series={s.slot}
                    cx={xs[cursor]}
                    cy={y(point.conversionPct)}
                    r={4}
                  />
                );
              })}
            </g>
          ) : null}

          {months.map((key, index) =>
            index % Math.ceil(months.length / 8) === 0 ? (
              <text
                key={key}
                className="chart__tick"
                x={x(index)}
                y={H - PAD_B + 20}
                textAnchor="middle"
              >
                {series[0].points.find((p) => p.month_key === key)?.month_start
                  ? formatMonthShort(series[0].points.find((p) => p.month_key === key)!.month_start!)
                  : String(key)}
              </text>
            ) : null,
          )}

          <line className="chart__axis" x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} />
          <text className="chart__panel-title" x={PAD_L} y={H - 6}>
            Bookings per 100 sessions
          </text>
        </svg>
      </div>

      <TableView
        label="Table view: conversion by channel"
        caption="Conversion over the range is computed from total bookings over total sessions, not by averaging the monthly rates: a mean of ratios would weight a quiet August the same as a busy January. Change compares the mean of the first three months against the last three, excluding partial months."
        columns={[
          {
            key: "channel",
            label: "Channel",
            render: (s: ChannelSeries) => s.channel_name.replace(/_/g, " "),
          },
          {
            key: "sessions",
            label: "Sessions",
            align: "right",
            render: (s) => formatNumber(s.totalSessions),
          },
          {
            key: "bookings",
            label: "Bookings",
            align: "right",
            render: (s) => formatNumber(s.totalBookings),
          },
          {
            key: "overall",
            label: "Conversion",
            align: "right",
            render: (s) => formatPercent(s.overallPct, 2),
          },
          {
            key: "first",
            label: "First 3 months",
            align: "right",
            render: (s) => formatPercent(s.firstPct, 2),
          },
          {
            key: "last",
            label: "Last 3 months",
            align: "right",
            render: (s) => formatPercent(s.lastPct, 2),
          },
          {
            key: "change",
            label: "Change",
            align: "right",
            render: (s) =>
              s.changePct === null
                ? "-"
                : `${s.changePct > 0 ? "+" : ""}${formatPercent(s.changePct, 0)}`,
          },
        ]}
        rows={series}
        rowKey={(s) => s.channel_name}
      />
    </div>
  );
}
