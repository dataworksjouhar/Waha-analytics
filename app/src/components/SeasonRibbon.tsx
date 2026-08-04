/* The season ribbon: twenty-four month bars that are both the date filter
 * and the dashboard's opening argument.
 *
 * A conventional date picker would treat "which months" as an
 * administrative detail. At this business it is the whole story: an outdoor
 * destination in Kuwait earns its year between mid-October and March and
 * survives June to August. Colouring the filter by season states that
 * before the reader has looked at a single chart, and makes "compare peak
 * to peak, not peak to trough" the natural thing to do rather than a
 * discipline the reader has to remember.
 *
 * Colour here is an ordinal single-hue ramp, not four unrelated hues:
 * trough, shoulder and peak are ordered, so darker reads as stronger
 * trading without consulting the legend. The legend is present anyway,
 * because season is never encoded by colour alone.
 *
 * Selection: click a month to select it, shift-click a second to select the
 * span between them. Filters scope everything below them, so every section
 * re-renders against the same slice and the numbers always agree.
 */

import type { DateRange, MonthCell } from "../lib/months";
import { formatMonthLong, formatMonthShort } from "../lib/format";

const SEASON_LABELS: Record<string, string> = {
  winter_peak: "Peak (mid-Oct to Mar)",
  shoulder: "Shoulder",
  summer_trough: "Summer trough",
};

const SEASON_SWATCH: Record<string, string> = {
  winter_peak: "var(--season-peak)",
  shoulder: "var(--season-shoulder)",
  summer_trough: "var(--season-trough)",
};

// Legend order follows the ramp, strongest season first, so the key reads
// as the ordered scale it is.
const LEGEND_ORDER = ["winter_peak", "shoulder", "summer_trough"];

interface Props {
  months: MonthCell[];
  range: DateRange | null;
  onRangeChange: (range: DateRange | null) => void;
}

export function SeasonRibbon({ months, range, onRangeChange }: Props) {
  const isSelected = (month: MonthCell) =>
    range === null || (month.monthStart <= range.end && month.monthEnd >= range.start);

  const handleClick = (month: MonthCell, extend: boolean) => {
    if (extend && range) {
      // Extend from whichever edge of the current selection is further
      // away, which is what a reader dragging a span expects.
      onRangeChange({
        start: month.monthStart < range.start ? month.monthStart : range.start,
        end: month.monthEnd > range.end ? month.monthEnd : range.end,
      });
      return;
    }
    onRangeChange({ start: month.monthStart, end: month.monthEnd });
  };

  const rangeLabel =
    range === null
      ? "All months"
      : range.start.slice(0, 7) === range.end.slice(0, 7)
        ? formatMonthLong(range.start)
        : `${formatMonthLong(range.start)} to ${formatMonthLong(range.end)}`;

  return (
    <section className="ribbon" aria-label="Season and date range filter">
      <div className="ribbon__head">
        <h2>Season</h2>
        <span className="ribbon__range">{rangeLabel}</span>
        <button
          type="button"
          className="ribbon__reset"
          onClick={() => onRangeChange(null)}
          disabled={range === null}
        >
          Show all
        </button>
      </div>

      <div className="ribbon__months" role="group">
        {months.map((month) => (
          <button
            key={month.monthStart}
            type="button"
            className="ribbon__month"
            data-season={month.season}
            data-selected={isSelected(month)}
            aria-pressed={isSelected(month)}
            title={`${formatMonthLong(month.monthStart)} - ${
              SEASON_LABELS[month.season] ?? month.season
            }`}
            onClick={(event) => handleClick(month, event.shiftKey)}
          >
            <span className="ribbon__bar" />
            <span className="ribbon__label">{formatMonthShort(month.monthStart)}</span>
          </button>
        ))}
      </div>

      <div className="ribbon__legend">
        {LEGEND_ORDER.filter((season) => months.some((m) => m.season === season)).map((season) => (
          <span className="ribbon__key" key={season}>
            <span className="ribbon__swatch" style={{ background: SEASON_SWATCH[season] }} />
            {SEASON_LABELS[season] ?? season}
          </span>
        ))}
        <span className="ribbon__key">Click a month, shift-click to select a span.</span>
      </div>
    </section>
  );
}
