/* Metric 2: what each own-operated venue earns per visitor.
 *
 * Two bars per venue, because there are two defensible denominators and
 * neither one deserves to stand in for the other silently:
 *
 *   site-wide  - venue revenue over ALL footfall that day. Conservative,
 *                and the honest headline, since a single Main Gate entry
 *                can reach the tenant strip, the Farm and the gym.
 *   entrance   - venue revenue over the footfall through the entrance its
 *                visitors actually use. Genuinely better for the
 *                Equestrian Centre, which has its own gate. Weaker for
 *                the three Main Gate venues, which all share one
 *                denominator, so none of it is really theirs.
 *
 * Showing both, side by side and labelled, is the point. The gap between
 * the pair is a measure of how much of the metric is attribution
 * assumption rather than measurement, and hiding that behind one number
 * would be the easiest lie in this whole dashboard.
 */

import { useState } from "react";
import { barPath, domainFrom, niceTicks, scaleLinear } from "../../lib/chart";
import { formatCurrency, formatNumber } from "../../lib/format";
import type { VenueConversionSummary } from "../../lib/footfall";
import { TableView } from "./TableView";

const W = 900;
const LABEL_W = 210;
const PAD_R = 74;
const BAR = 14;
const ROW = 52;
const TOP = 10;

export function VenueConversionChart({
  venues,
  currency,
}: {
  venues: VenueConversionSummary[];
  currency: string;
}) {
  const [hover, setHover] = useState<string | null>(null);

  if (venues.length === 0) {
    return <p className="chart__empty">No venue sales in the selected range.</p>;
  }

  const values = venues.flatMap((v) =>
    [v.revenuePerSiteVisitor, v.revenuePerEntranceVisitor].filter((n): n is number => n !== null),
  );
  const domain = domainFrom(values);
  const x = scaleLinear(domain, [LABEL_W, W - PAD_R]);
  const ticks = niceTicks(domain[0], domain[1], 4);
  const height = TOP + venues.length * ROW + 30;
  const zero = x(0);

  const series: {
    key: "revenuePerSiteVisitor" | "revenuePerEntranceVisitor";
    slot: string;
    label: string;
  }[] = [
    { key: "revenuePerSiteVisitor", slot: "1", label: "Per site-wide visitor" },
    { key: "revenuePerEntranceVisitor", slot: "2", label: "Per entrance visitor" },
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
        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${height}`}
          role="img"
          aria-label="Revenue per visitor by venue, on two denominators"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart__grid" x1={x(tick)} x2={x(tick)} y1={TOP} y2={height - 30} />
              <text className="chart__tick" x={x(tick)} y={height - 12} textAnchor="middle">
                {formatNumber(tick, 2)}
              </text>
            </g>
          ))}

          {venues.map((venue, index) => {
            const rowTop = TOP + index * ROW;
            return (
              <g
                key={venue.venue_id}
                className="chart__row"
                onPointerEnter={() => setHover(venue.venue_id)}
                onPointerLeave={() => setHover(null)}
              >
                {/* Hover marks the row rather than fading the others: a
                    pointer left resting after a scroll would otherwise
                    leave most of the chart dimmed, which reads as a
                    rendering fault rather than as emphasis. */}
                {hover === venue.venue_id ? (
                  <rect className="chart__row-band" x={0} y={rowTop} width={W} height={ROW} />
                ) : null}
                {/* Hit target spans the whole row, so hovering anywhere
                    near a short bar works. A 14px bar is not a target. */}
                <rect className="chart__hit" x={0} y={rowTop} width={W} height={ROW} />
                <text className="chart__row-label" x={0} y={rowTop + 20}>
                  {venue.venue_name}
                </text>
                <text className="chart__row-sub" x={0} y={rowTop + 36}>
                  via {venue.gate_proximity ?? "unassigned"}
                </text>

                {series.map((s, seriesIndex) => {
                  const value = venue[s.key];
                  if (value === null) return null;
                  // 2px of surface between the pair, per the mark spec:
                  // white does the separating, never a stroke.
                  const y = rowTop + 8 + seriesIndex * (BAR + 2);
                  const width = x(value) - zero;
                  return (
                    <g key={s.key}>
                      <path
                        className="chart__bar"
                        data-series={s.slot}
                        d={barPath(zero, y, width, BAR, 4, "right")}
                      />
                      <text className="chart__bar-label" x={x(value) + 8} y={y + BAR - 3}>
                        {formatCurrency(value, currency, 3)}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}

          <line className="chart__axis" x1={zero} x2={zero} y1={TOP} y2={height - 30} />
        </svg>
      </div>

      <TableView
        label="Table view: revenue per visitor by venue"
        caption="Site-wide divides by all footfall that day. Entrance divides by the gate this venue's visitors use, which three of the four venues share."
        columns={[
          { key: "venue", label: "Venue", render: (v: VenueConversionSummary) => v.venue_name },
          { key: "zone", label: "Zone", render: (v) => v.zone ?? "-" },
          { key: "gate", label: "Entrance", render: (v) => v.gate_proximity ?? "-" },
          {
            key: "revenue",
            label: `Revenue ${currency}`,
            align: "right",
            render: (v) => formatCurrency(v.revenue_kwd, currency),
          },
          {
            key: "site",
            label: "Per site visitor",
            align: "right",
            render: (v) => formatCurrency(v.revenuePerSiteVisitor, currency, 3),
          },
          {
            key: "entrance",
            label: "Per entrance visitor",
            align: "right",
            render: (v) => formatCurrency(v.revenuePerEntranceVisitor, currency, 3),
          },
        ]}
        rows={venues}
        rowKey={(v) => v.venue_id}
      />
    </div>
  );
}
