/* Metric 5: online versus walk-in, at the grain where the two are
 * comparable.
 *
 * One bar per venue and category, split into the two channels. A stacked
 * bar is right here for the same reason it was right for rent: the parts
 * sum to something real, namely every unit of that product sold through
 * either route. Each bar is normalised to 100% because the question is
 * mix, not volume, and volume differs by a factor of thirty across these
 * rows. Absolute quantities are on the bar and in the table, so nothing
 * is lost by normalising.
 *
 * Rows where the website sells fewer SKUs than the till carry a marker.
 * That is not decoration: it is the difference between "44% of Playground
 * tickets are bought online" (true) and "child tickets never sell online"
 * (false, they are simply not a separate product on the website).
 */

import { useState } from "react";
import { barPath } from "../../lib/chart";
import { formatCurrency, formatNumber, formatPercent } from "../../lib/format";
import type { ChannelMixGroup } from "../../lib/online";
import { TableView } from "./TableView";

const W = 900;
const LABEL_W = 250;
const PAD_R = 66;
const BAR = 22;
const ROW = 46;
const TOP = 12;

const prettyCategory = (category: string) => category.replace(/_/g, " ");

export function ChannelMixChart({
  groups,
  currency,
}: {
  groups: ChannelMixGroup[];
  currency: string;
}) {
  const [hover, setHover] = useState<string | null>(null);

  if (groups.length === 0) {
    return <p className="chart__empty">No ticket sales in the selected range.</p>;
  }

  const height = TOP + groups.length * ROW + 30;
  const plotWidth = W - LABEL_W - PAD_R;

  return (
    <div className="chart">
      <div className="chart__legend">
        <span className="chart__key">
          <span className="chart__swatch" data-series="1" />
          Online booking
        </span>
        <span className="chart__key">
          <span className="chart__swatch" data-series="4" />
          Walk-in till
        </span>
      </div>

      <div className="chart__figure">
        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${height}`}
          role="img"
          aria-label="Online versus walk-in share by venue and product category"
        >
          {groups.map((group, index) => {
            const rowTop = TOP + index * ROW;
            const barY = rowTop + (ROW - BAR) / 2;
            const share = group.onlineSharePct ?? 0;
            const onlineWidth = (share / 100) * plotWidth;
            const walkInWidth = plotWidth - onlineWidth;

            return (
              <g
                key={group.key}
                onPointerEnter={() => setHover(group.key)}
                onPointerLeave={() => setHover(null)}
              >
                {hover === group.key ? (
                  <rect className="chart__row-band" x={0} y={rowTop} width={W} height={ROW} />
                ) : null}
                <rect className="chart__hit" x={0} y={rowTop} width={W} height={ROW} />

                <text className="chart__row-label" x={0} y={rowTop + 19}>
                  {group.venue_name}
                </text>
                <text className="chart__row-sub" x={0} y={rowTop + 34}>
                  {prettyCategory(group.category)}, {formatNumber(group.totalQty)} sold
                  {group.crosswalked ? " (website sells one SKU here)" : ""}
                </text>

                {onlineWidth > 0 ? (
                  <path
                    className="chart__bar"
                    data-series="1"
                    d={barPath(LABEL_W, barY, onlineWidth - 2, BAR, 4, "left")}
                  />
                ) : null}
                {walkInWidth > 0 ? (
                  <path
                    className="chart__bar"
                    data-series="4"
                    d={barPath(LABEL_W + onlineWidth, barY, walkInWidth, BAR, 4, "right")}
                  />
                ) : null}

                {/* Labelled inside the segment only when it is wide enough
                    to hold the text, otherwise the number would overhang
                    into its neighbour and read as belonging to it. */}
                {onlineWidth > 46 ? (
                  <text className="chart__bar-inline" x={LABEL_W + 8} y={barY + BAR - 7}>
                    {formatPercent(Math.round(share), 0)}
                  </text>
                ) : null}

                <text className="chart__bar-label" x={W - PAD_R + 8} y={barY + BAR - 7}>
                  {formatPercent(share, 0)}
                </text>
              </g>
            );
          })}

          <line className="chart__axis" x1={LABEL_W} x2={LABEL_W} y1={TOP} y2={height - 30} />
          <text className="chart__panel-title" x={0} y={height - 8}>
            Share of units sold, online booking versus walk-in till
          </text>
        </svg>
      </div>

      <TableView
        label="Table view: online versus walk-in by product"
        caption="Grouped by venue and category, because that is where the two channels are comparable. The website sells one ticket per venue while the till sells adult, child and family variants, so a per-SKU online share is an artifact of that crosswalk rather than a fact about how customers buy. SKU rows are listed under each group for completeness."
        columns={[
          { key: "venue", label: "Venue", render: (g: ChannelMixGroup) => g.venue_name },
          { key: "category", label: "Category", render: (g) => prettyCategory(g.category) },
          {
            key: "skus",
            label: "SKUs",
            render: (g) =>
              g.products
                .map((p) => p.product_name)
                .sort()
                .join(", "),
          },
          {
            key: "online",
            label: "Online units",
            align: "right",
            render: (g) => formatNumber(g.onlineQty),
          },
          {
            key: "walkin",
            label: "Walk-in units",
            align: "right",
            render: (g) => formatNumber(g.walkInQty),
          },
          {
            key: "share",
            label: "Online share",
            align: "right",
            render: (g) => formatPercent(g.onlineSharePct, 1),
          },
          {
            key: "value",
            label: `Online value ${currency}`,
            align: "right",
            render: (g) => formatCurrency(g.onlineAmount, currency),
          },
        ]}
        rows={groups}
        rowKey={(g) => g.key}
      />
    </div>
  );
}
