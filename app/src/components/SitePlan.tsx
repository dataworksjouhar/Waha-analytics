/* The site plan: the park as a place rather than a table.
 *
 * Why this exists. A general manager does not picture his business as
 * eleven rows of tenant data, he pictures the site. Leasing is spatial:
 * sales per square metre is a spatial measure, a vacancy is a hole in a
 * terrace, and "which units get walked past but not walked into" is a
 * placement question that a table cannot ask. This view puts the numbers
 * back where they happen.
 *
 * Two encodings on one mark:
 *   size = floor area, true to dim_tenant.unit_sqm
 *   fill = the selected metric, on a validated five-step ramp
 * The pairing is the point. A large pale plot is a big unit trading
 * badly, and it is the first thing the eye finds. In a table it is just
 * another row.
 *
 * The gates are sized by footfall at the selected hour, so dragging the
 * scrubber turns the evening-weighted curve into something you watch.
 *
 * Honest limits, stated on screen rather than buried here: the layout is
 * a stylised schematic, and footfall is measured at gates, not at shop
 * doors, so this view cannot tell you who walked past a specific unit.
 */

import { useMemo, useRef, useState, type MouseEvent } from "react";
import { formatCurrency, formatNumber } from "../lib/format";
import {
  aggregateByUnit,
  bucketByRank,
  FILL_METRICS,
  gatePeakHours,
  gateVolumes,
  HOURS_ALL,
  type GateHourFootfall,
  type SitePlanData,
  type SiteUnit,
  type TenantSiteMetric,
  type UnitValue,
} from "../lib/sitePlan";
import type { DateRange, MonthCell } from "../lib/months";

const RAMP = ["var(--fill-1)", "var(--fill-2)", "var(--fill-3)", "var(--fill-4)", "var(--fill-5)"];

const GATE_MIN_R = 9;
const GATE_MAX_R = 30;

interface Props {
  plan: SitePlanData;
  tenantMetrics: TenantSiteMetric[];
  gateFootfall: GateHourFootfall[];
  months: MonthCell[];
  range: DateRange | null;
  currency: string;
  /** the site's name, from config via meta.json. Passed in rather than
   *  written here so a rebrand stays a YAML edit. */
  siteName: string;
}

interface Hover {
  x: number;
  y: number;
  title: string;
  value: string;
  meta: string;
}

export function SitePlan({
  plan,
  tenantMetrics,
  gateFootfall,
  months,
  range,
  currency,
  siteName,
}: Props) {
  const [metricId, setMetricId] = useState(FILL_METRICS[0].id);
  const [hour, setHour] = useState<number>(HOURS_ALL);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const figureRef = useRef<HTMLDivElement>(null);

  const metric = FILL_METRICS.find((m) => m.id === metricId) ?? FILL_METRICS[0];

  // The season ribbon scopes this view like everything else, so the map
  // and the charts below can never disagree about which months are in play.
  const monthKeys = useMemo(() => {
    const inRange = months.filter(
      (m) => range === null || (m.monthStart <= range.end && m.monthEnd >= range.start),
    );
    return new Set(inRange.map((m) => m.monthStart));
  }, [months, range]);

  const unitValues = useMemo(
    () => aggregateByUnit(tenantMetrics.filter((r) => monthKeys.has(r.month_start)), metric),
    [tenantMetrics, monthKeys, metric],
  );

  const buckets = useMemo(() => bucketByRank(unitValues), [unitValues]);
  const gateVols = useMemo(
    () => gateVolumes(gateFootfall, monthKeys, hour),
    [gateFootfall, monthKeys, hour],
  );
  const peakHours = useMemo(
    () => gatePeakHours(gateFootfall, monthKeys),
    [gateFootfall, monthKeys],
  );

  const maxGate = Math.max(...[...gateVols.values()].map((g) => g.value), 1);

  const formatValue = (value: number | null) => {
    if (value === null) return "no submission";
    if (metric.format === "currency") return formatCurrency(value, currency, 0);
    if (metric.format === "days") return `${formatNumber(value, 1)} days`;
    return formatNumber(value, 0);
  };

  const fillFor = (unit: SiteUnit) => {
    if (unit.status !== "active") return undefined; // hatched by CSS
    const step = buckets.get(unit.unit_no);
    return step ? RAMP[step - 1] : "var(--gridline)";
  };

  const unitClass = (unit: SiteUnit) => {
    const classes = ["plan__unit"];
    if (unit.status !== "active") classes.push("plan__unit--closed");
    else if (!buckets.has(unit.unit_no)) classes.push("plan__unit--nodata");
    if (selected === unit.unit_no) classes.push("plan__unit--selected");
    return classes.join(" ");
  };

  const showTooltip = (
    event: MouseEvent<SVGGElement>,
    title: string,
    value: string,
    meta: string,
  ) => {
    const box = figureRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      title,
      value,
      meta,
    });
  };

  const ranked = useMemo(
    () =>
      [...unitValues.values()]
        .filter((v) => v.value !== null)
        .sort((a, b) => (b.value as number) - (a.value as number)),
    [unitValues],
  );

  const unitByNo = useMemo(
    () => new Map(plan.units.map((u) => [u.unit_no, u])),
    [plan.units],
  );

  // Terrace captions are derived from where the plots actually landed
  // rather than positioned by hand, so they follow the units if a lease
  // changes size and the row grows.
  const terraceLabels = useMemo(() => {
    const byTerrace = new Map<string, { label: string; x: number; y: number }>();
    for (const unit of plan.units) {
      const existing = byTerrace.get(unit.terrace_id);
      if (!existing) {
        byTerrace.set(unit.terrace_id, { label: unit.terrace_label, x: unit.x, y: unit.y });
      } else {
        existing.x = Math.min(existing.x, unit.x);
        existing.y = Math.min(existing.y, unit.y);
      }
    }
    return [...byTerrace.values()];
  }, [plan.units]);

  const selectedUnit = selected ? unitByNo.get(selected) : undefined;
  const selectedValue: UnitValue | undefined = selected ? unitValues.get(selected) : undefined;

  const hourLabel =
    hour === HOURS_ALL ? "Whole day" : `${String(hour).padStart(2, "0")}:00`;

  const [vbX, vbY, vbW, vbH] = plan.viewbox;

  return (
    <div className="plan">
      <div>
        <div className="plan__controls">
          <div className="plan__metrics" role="group" aria-label="Colour plots by">
            {FILL_METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                className="plan__metric"
                aria-pressed={m.id === metricId}
                onClick={() => setMetricId(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <label className="plan__hour">
            Gate volume at
            <span className="plan__hour-value">{hourLabel}</span>
            <input
              type="range"
              min={-1}
              max={23}
              step={1}
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              aria-label="Hour of day for gate footfall"
            />
          </label>
        </div>

        <div className="plan__figure" ref={figureRef}>
          <svg
            className="plan__svg"
            viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
            role="img"
            aria-label={`Site plan of ${siteName}`}
          >
            <defs>
              {/* Vacant units are hatched, not coloured: a closed shop has
                  no value on any metric, and giving it the palest fill
                  would make it read as "trading badly" instead of "empty". */}
              <pattern
                id="vacant-hatch"
                width="8"
                height="8"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="8" height="8" fill="var(--gridline)" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="var(--text-muted)" strokeWidth="2" />
              </pattern>
            </defs>

            <rect
              className="plan__site"
              x={vbX + 10}
              y={vbY + 10}
              width={vbW - 20}
              height={vbH - 20}
              rx={18}
            />

            <polyline
              className="plan__promenade"
              points={plan.promenade.map(([x, y]) => `${x},${y}`).join(" ")}
            />

            {plan.venues.map((venue) => {
              const [x, y, w, h] = venue.rect;
              return (
                <g
                  key={venue.venue_id}
                  className="plan__venue"
                  onMouseMove={(e) =>
                    showTooltip(e, venue.venue_name, "Own-operated venue", venue.venue_type)
                  }
                  onMouseLeave={() => setHover(null)}
                >
                  <rect x={x} y={y} width={w} height={h} />
                  <text x={x + 12} y={y + 24}>
                    {venue.label}
                  </text>
                  <text className="plan__venue-sub" x={x + 12} y={y + 42}>
                    own-operated
                  </text>
                </g>
              );
            })}

            {plan.units.map((unit) => {
              const value = unitValues.get(unit.unit_no);
              const meta =
                unit.status !== "active"
                  ? `${unit.unit_no} - lease ended`
                  : `${unit.unit_no} - ${unit.category} - ${formatNumber(unit.unit_sqm)} sqm`;
              return (
                <g
                  key={unit.unit_no}
                  className={unitClass(unit)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${unit.tenant_name}, unit ${unit.unit_no}`}
                  onClick={() => setSelected(selected === unit.unit_no ? null : unit.unit_no)}
                  onMouseMove={(e) =>
                    showTooltip(
                      e,
                      unit.tenant_name,
                      unit.status !== "active"
                        ? "Vacant"
                        : `${metric.label}: ${formatValue(value?.value ?? null)}`,
                      meta,
                    )
                  }
                  onMouseLeave={() => setHover(null)}
                >
                  <rect
                    x={unit.x}
                    y={unit.y}
                    width={unit.width}
                    height={unit.height}
                    fill={fillFor(unit)}
                    rx={3}
                  />
                  {/* Just the number, not the full "U-118": the smallest
                      plot on the site is 22px on its short side, and the
                      terrace caption already establishes the prefix.
                      Labelling all units beats labelling only the big ones,
                      which reads as though the small shops are unnamed.
                      A vertical terrace labels to the right of each plot,
                      since underneath is where the next unit starts. */}
                  {unit.orientation === "vertical" ? (
                    <text
                      x={unit.x + unit.width + 5}
                      y={unit.y + unit.height / 2 + 3}
                      textAnchor="start"
                    >
                      {unit.unit_no.replace(/^U-/, "")}
                    </text>
                  ) : (
                    <text
                      x={unit.x + unit.width / 2}
                      y={unit.y + unit.height + 14}
                      textAnchor="middle"
                    >
                      {unit.unit_no.replace(/^U-/, "")}
                    </text>
                  )}
                </g>
              );
            })}

            {terraceLabels.map((terrace) => (
              <text
                key={terrace.label}
                className="plan__terrace-label"
                x={terrace.x}
                y={terrace.y - 10}
              >
                {terrace.label}
              </text>
            ))}

            {plan.gates.map((gate) => {
              const [x, y] = gate.at;
              const volume = gateVols.get(gate.gate_id);
              const radius =
                GATE_MIN_R +
                (GATE_MAX_R - GATE_MIN_R) * Math.sqrt((volume?.value ?? 0) / maxGate);
              // Gates sit at the site edges, so a label centred on the
              // circle runs off the drawing. Each gate declares which side
              // its name hangs on, and the anchor follows.
              const labelPlacements: Record<
                string,
                { dx: number; dy: number; anchor: "start" | "middle" | "end" }
              > = {
                above: { dx: 0, dy: -radius - 10, anchor: "middle" },
                below: { dx: 0, dy: radius + 18, anchor: "middle" },
                right: { dx: radius + 8, dy: 4, anchor: "start" },
                left: { dx: -radius - 8, dy: 4, anchor: "end" },
              };
              const label = labelPlacements[gate.label_side] ?? labelPlacements.below;
              return (
                <g
                  key={gate.gate_id}
                  className="plan__gate"
                  onMouseMove={(e) =>
                    showTooltip(
                      e,
                      gate.gate_name,
                      `${formatNumber(volume?.value ?? 0)} in ${
                        hour === HOURS_ALL ? "per day" : `at ${hourLabel}`
                      }`,
                      [
                        peakHours.has(gate.gate_id)
                          ? `busiest at ${String(peakHours.get(gate.gate_id)).padStart(2, "0")}:00`
                          : null,
                        volume?.imputed ? "includes imputed hours" : null,
                      ]
                        .filter(Boolean)
                        .join(" - "),
                    )
                  }
                  onMouseLeave={() => setHover(null)}
                >
                  {/* radius encodes volume by AREA, so the circle grows as
                      sqrt of the value: a gate twice as busy looks twice as
                      big, not four times */}
                  <circle cx={x} cy={y} r={radius} />
                  <text
                    x={x + label.dx}
                    y={y + label.dy}
                    textAnchor={label.anchor}
                  >
                    {gate.gate_name}
                  </text>
                </g>
              );
            })}
          </svg>

          {hover && (
            <div
              className="plan__tooltip"
              style={{
                left: Math.min(hover.x + 14, 600),
                top: hover.y + 14,
              }}
            >
              <strong>{hover.title}</strong>
              <div className="plan__tooltip-value">{hover.value}</div>
              <div className="plan__tooltip-meta">{hover.meta}</div>
            </div>
          )}
        </div>

        {/* The ramp reverses between light and dark mode, so the legend
            says "low to high" rather than naming a colour. "Dark means
            high" would be a lie on half the screens it renders on. */}
        <div className="plan__legend">
          <span>{metric.label}</span>
          <span>low</span>
          <span className="plan__ramp">
            {RAMP.map((c) => (
              <span key={c} style={{ background: c }} />
            ))}
          </span>
          <span>high</span>
          <span>&middot; high means {metric.highMeans}</span>
          <span>&middot; plot area is true to floor area</span>
          <span>&middot; hatched is vacant</span>
        </div>

        <p className="plan__caveat">
          Stylised schematic of the fictional {siteName}: unit areas are true to the
          leased square metres in the warehouse, positions are illustrative. Footfall is
          counted at the gates, not at shop doors, so this view cannot say who walked
          past an individual unit.
        </p>
      </div>

      <div className="plan__side">
        <div className="card">
          <h3>{metric.label}</h3>
          <p className="card__note">Ranked, highest first.</p>
          <ul className="plan__rank">
            {ranked.map((entry) => {
              const unit = unitByNo.get(entry.unit_no);
              const step = buckets.get(entry.unit_no) ?? 1;
              return (
                <li
                  key={entry.unit_no}
                  aria-selected={selected === entry.unit_no}
                  onClick={() =>
                    setSelected(selected === entry.unit_no ? null : entry.unit_no)
                  }
                >
                  <span
                    className="plan__rank-swatch"
                    style={{ background: RAMP[step - 1] }}
                  />
                  <span className="plan__rank-name">{unit?.tenant_name ?? entry.unit_no}</span>
                  <span className="plan__rank-value">{formatValue(entry.value)}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {selectedUnit && (
          <div className="card plan__detail">
            <h3>{selectedUnit.tenant_name}</h3>
            <p className="card__note">
              {selectedUnit.unit_no} &middot; {selectedUnit.category}
            </p>
            <dl>
              <dt>Floor area</dt>
              <dd>{formatNumber(selectedUnit.unit_sqm)} sqm</dd>
              <dt>{metric.label}</dt>
              <dd>{formatValue(selectedValue?.value ?? null)}</dd>
              <dt>Months in range</dt>
              <dd>{selectedValue?.monthCount ?? 0}</dd>
              <dt>Status</dt>
              <dd>{selectedUnit.status}</dd>
            </dl>
            {(selectedValue?.restatedCount ?? 0) > 0 && (
              <div className="plan__flag">
                {selectedValue?.restatedCount} restated submission
                {selectedValue?.restatedCount === 1 ? "" : "s"} in this range
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
