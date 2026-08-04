/* Metric 10: average transaction value by venue.
 *
 * One series, so one colour and no legend box: the title already says
 * what is plotted, and a legend with a single swatch just restates it.
 * Colouring each bar darker-where-bigger would be worse still, since the
 * four venues have no natural order and the bar length already carries
 * the magnitude.
 *
 * Refunds are counted beside the average rather than folded into it. The
 * view averages genuine purchases only, so a venue that refunds heavily
 * would otherwise look identical to one that does not, and the refund
 * count is the thing that tells them apart.
 *
 * gold.vw_avg_transaction_value has no date column: it is a whole-history
 * aggregate. This chart therefore does NOT respond to the season filter,
 * and says so on screen rather than appearing to update.
 */

import { barPath, domainFrom, niceTicks, scaleLinear } from "../../lib/chart";
import { formatCurrency, formatNumber } from "../../lib/format";
import type { VenueAtv } from "../../lib/footfall";
import { TableView } from "./TableView";

const W = 900;
const LABEL_W = 210;
const PAD_R = 90;
const BAR = 16;
const ROW = 42;
const TOP = 10;

export function AtvChart({ venues, currency }: { venues: VenueAtv[]; currency: string }) {
  if (venues.length === 0) {
    return <p className="chart__empty">No venue transactions.</p>;
  }

  const ordered = [...venues].sort(
    (a, b) => (b.avg_transaction_value_kwd ?? 0) - (a.avg_transaction_value_kwd ?? 0),
  );
  const domain = domainFrom(
    ordered.map((v) => v.avg_transaction_value_kwd).filter((v): v is number => v !== null),
  );
  const x = scaleLinear(domain, [LABEL_W, W - PAD_R]);
  const ticks = niceTicks(domain[0], domain[1], 4);
  const height = TOP + ordered.length * ROW + 30;
  const zero = x(0);

  return (
    <div className="chart">
      <div className="chart__figure">
        <svg
          className="chart__svg"
          viewBox={`0 0 ${W} ${height}`}
          role="img"
          aria-label="Average transaction value by venue"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart__grid" x1={x(tick)} x2={x(tick)} y1={TOP} y2={height - 30} />
              <text className="chart__tick" x={x(tick)} y={height - 12} textAnchor="middle">
                {formatNumber(tick)}
              </text>
            </g>
          ))}

          {ordered.map((venue, index) => {
            const rowTop = TOP + index * ROW;
            const value = venue.avg_transaction_value_kwd;
            return (
              <g key={venue.venue_id}>
                <text className="chart__row-label" x={0} y={rowTop + 18}>
                  {venue.venue_name}
                </text>
                <text className="chart__row-sub" x={0} y={rowTop + 33}>
                  {formatNumber(venue.sale_invoice_count)} sales
                  {venue.refund_invoice_count > 0
                    ? `, ${formatNumber(venue.refund_invoice_count)} refunds`
                    : ""}
                </text>
                {value === null ? null : (
                  <>
                    <path
                      className="chart__bar"
                      data-series="1"
                      d={barPath(zero, rowTop + 8, x(value) - zero, BAR, 4, "right")}
                    />
                    <text className="chart__bar-label" x={x(value) + 8} y={rowTop + 8 + BAR - 3}>
                      {formatCurrency(value, currency, 2)}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          <line className="chart__axis" x1={zero} x2={zero} y1={TOP} y2={height - 30} />
        </svg>
      </div>

      <TableView
        label="Table view: average transaction value"
        columns={[
          { key: "venue", label: "Venue", render: (v: VenueAtv) => v.venue_name },
          { key: "type", label: "Type", render: (v) => v.venue_type },
          {
            key: "atv",
            label: `Average sale ${currency}`,
            align: "right",
            render: (v) => formatCurrency(v.avg_transaction_value_kwd, currency, 2),
          },
          { key: "sales", label: "Sale invoices", align: "right", render: (v) => formatNumber(v.sale_invoice_count) },
          {
            key: "refunds",
            label: "Refund invoices",
            align: "right",
            render: (v) => formatNumber(v.refund_invoice_count),
          },
          {
            key: "net",
            label: `Net revenue ${currency}`,
            align: "right",
            render: (v) => formatCurrency(v.net_revenue_kwd, currency),
          },
        ]}
        rows={ordered}
        rowKey={(v) => v.venue_id}
      />
    </div>
  );
}
