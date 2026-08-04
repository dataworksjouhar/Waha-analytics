/* Metric 7: did the event pay for itself?
 *
 * Two panels, one row per event, sharing the event order: extra visitors
 * per day on the left, extra sales per day on the right, both measured
 * against the same trailing 14-day baseline the view computes.
 *
 * They are separate panels rather than one chart with two axes because
 * visitors and dinars have no common scale, and overlaying them would
 * manufacture a relationship. Side by side on a shared row order, the
 * reader compares them by scanning across, and the case that matters
 * jumps out: a row with a long blue bar on the left and a red bar on the
 * right is an event that pulled a crowd in and sold less than an ordinary
 * day. That is the finding this metric exists for, and it is invisible in
 * any footfall-only view.
 *
 * Blue and red are the documented diverging pair: warm and cool read as
 * opposite, and zero is the axis rather than a third hue.
 */

import { useState } from "react";
import { barPath, domainFrom, niceTicks, scaleLinear } from "../../lib/chart";
import { formatCurrency, formatNumber } from "../../lib/format";
import { isCrowdedButUnprofitable, type EventRoi } from "../../lib/footfall";
import { TableView } from "./TableView";

const W = 900;
const LABEL_W = 250;
const GAP = 34;
const PANEL_W = (W - LABEL_W - GAP) / 2;
const ROW = 24;
const BAR = 12;
const TOP = 30;

interface PanelSpec {
  title: string;
  value: (event: EventRoi) => number | null;
  format: (value: number | null) => string;
}

export function EventRoiChart({ events, currency }: { events: EventRoi[]; currency: string }) {
  const [hover, setHover] = useState<string | null>(null);

  if (events.length === 0) {
    return <p className="chart__empty">No events in the selected range.</p>;
  }

  const panels: PanelSpec[] = [
    {
      title: "Extra visitors per day",
      value: (e) => e.footfall_uplift_per_day,
      format: (v) => (v === null ? "-" : formatNumber(v)),
    },
    {
      title: `Extra sales per day (${currency})`,
      value: (e) => e.sales_uplift_per_day_kwd,
      format: (v) => (v === null ? "-" : formatCurrency(v, currency)),
    },
  ];

  const scales = panels.map((panel, panelIndex) => {
    const left = LABEL_W + panelIndex * (PANEL_W + GAP);
    const domain = domainFrom(
      events.map(panel.value).filter((v): v is number => v !== null),
    );
    return {
      x: scaleLinear(domain, [left, left + PANEL_W]),
      ticks: niceTicks(domain[0], domain[1], 3),
      left,
    };
  });

  const height = TOP + events.length * ROW + 26;

  return (
    <div className="chart">
      <div className="chart__legend">
        <span className="chart__key">
          <span className="chart__swatch" data-series="1" />
          Above the 14-day baseline
        </span>
        <span className="chart__key">
          <span className="chart__swatch" data-series="8" />
          Below the baseline
        </span>
      </div>

      <div className="chart__figure">
        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${height}`}
          role="img"
          aria-label="Event uplift against a 14-day baseline: extra visitors per day and extra sales per day"
        >
          {panels.map((panel, panelIndex) => {
            const scale = scales[panelIndex];
            return (
              <g key={panel.title}>
                <text className="chart__panel-title" x={scale.left} y={14}>
                  {panel.title}
                </text>
                {scale.ticks.map((tick) => (
                  <g key={tick}>
                    <line
                      className="chart__grid"
                      x1={scale.x(tick)}
                      x2={scale.x(tick)}
                      y1={TOP - 8}
                      y2={height - 24}
                    />
                    <text
                      className="chart__tick"
                      x={scale.x(tick)}
                      y={height - 8}
                      textAnchor="middle"
                    >
                      {formatNumber(tick)}
                    </text>
                  </g>
                ))}
                <line
                  className="chart__axis"
                  x1={scale.x(0)}
                  x2={scale.x(0)}
                  y1={TOP - 8}
                  y2={height - 24}
                />
              </g>
            );
          })}

          {events.map((event, index) => {
            const rowTop = TOP + index * ROW;
            const flagged = isCrowdedButUnprofitable(event);
            return (
              <g
                key={event.event_id}
                onPointerEnter={() => setHover(event.event_id)}
                onPointerLeave={() => setHover(null)}
              >
                {/* Hover marks the row rather than dimming the other
                    sixteen. Dimming is louder than the thing it is
                    pointing at, and a pointer left resting after a scroll
                    leaves most of the chart faded with no way to tell
                    that from a rendering fault. */}
                {hover === event.event_id ? (
                  <rect className="chart__row-band" x={0} y={rowTop} width={W} height={ROW} />
                ) : null}
                <rect className="chart__hit" x={0} y={rowTop} width={W} height={ROW} />
                <text
                  className="chart__row-label chart__row-label--sm"
                  x={0}
                  y={rowTop + BAR + 4}
                  data-flagged={flagged ? "true" : undefined}
                >
                  {flagged ? "! " : ""}
                  {event.event_name}
                </text>

                {panels.map((panel, panelIndex) => {
                  const value = panel.value(event);
                  const scale = scales[panelIndex];
                  if (value === null) {
                    return (
                      <text
                        key={panel.title}
                        className="chart__nodata"
                        x={scale.left + 6}
                        y={rowTop + BAR + 3}
                      >
                        not measurable
                      </text>
                    );
                  }
                  const zero = scale.x(0);
                  const width = scale.x(value) - zero;
                  return (
                    <path
                      key={panel.title}
                      className="chart__bar"
                      data-series={value < 0 ? "8" : "1"}
                      d={barPath(
                        Math.min(zero, zero + width),
                        rowTop + 2,
                        Math.abs(width),
                        BAR,
                        3,
                        value < 0 ? "left" : "right",
                      )}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      <p className="chart__note">
        An event marked <strong>!</strong> drew more visitors than a normal day and still took less
        money than one. The baseline is the 14 days before the event, skipping any day inside
        another event's window so overlapping events do not flatten each other's comparison.
      </p>

      <TableView
        label={`Table view: event ROI (${events.length} events)`}
        columns={[
          { key: "name", label: "Event", render: (e: EventRoi) => e.event_name },
          { key: "type", label: "Type", render: (e) => e.event_type ?? "-" },
          { key: "start", label: "Start", render: (e) => e.start_date },
          { key: "days", label: "Days", align: "right", render: (e) => formatNumber(e.event_day_count) },
          {
            key: "ff",
            label: "Extra visitors/day",
            align: "right",
            render: (e) => formatNumber(e.footfall_uplift_per_day),
          },
          {
            key: "sales",
            label: `Extra sales/day ${currency}`,
            align: "right",
            render: (e) => formatCurrency(e.sales_uplift_per_day_kwd, currency),
          },
          {
            key: "base",
            label: "Baseline visitors/day",
            align: "right",
            render: (e) => formatNumber(e.baseline_avg_footfall),
          },
        ]}
        rows={events}
        rowKey={(e) => e.event_id}
      />
    </div>
  );
}
