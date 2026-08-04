/* Small chart primitives, shared by every charted section.
 *
 * There is no charting library here on purpose. The four things a library
 * would give us are a linear scale, a path string, a set of round axis
 * ticks and a nearest-point lookup, and all four are a few lines each.
 * Pulling in Recharts or d3 to get them would add a dependency larger
 * than the dashboard, and would put a layer between the exported gold
 * data and the marks on screen that has to be explained in an interview.
 *
 * Everything here is pure: numbers in, numbers or strings out, no React
 * and no DOM, so it is testable without a browser.
 */

export interface Scale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
}

/** Maps a data domain onto a pixel range. A zero-width domain (one point,
 *  or every value identical) would divide by zero, so it collapses to the
 *  middle of the range rather than returning NaN and silently blanking the
 *  chart. */
export function scaleLinear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const fn = ((value: number) =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  fn.domain = domain;
  fn.range = range;
  return fn;
}

/** Round tick values across a domain: 0, 1000, 2000 rather than 0, 873,
 *  1746. Steps are restricted to 1, 2, 2.5, 5 or 10 times a power of ten,
 *  which is the set that reads as "a round number" to everyone. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const rawStep = (max - min) / Math.max(count, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2.5 ? 5 : normalized > 2 ? 2.5 : normalized > 1 ? 2 : 1) * magnitude;

  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  // Accumulate by multiplication rather than repeated addition: adding
  // 0.1 to itself thirty times drifts, and the tick labels would print
  // 0.30000000000000004.
  for (let i = 0; start + i * step <= max + step * 1e-9; i += 1) {
    ticks.push(Number((start + i * step).toPrecision(12)));
  }
  return ticks;
}

/** A domain padded to include zero and rounded out to the next tick, so
 *  bars grow from a true baseline and the topmost point is not glued to
 *  the ceiling of the plot. */
export function domainFrom(values: number[], includeZero = true): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [0, 1];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) return min === 0 ? [0, 1] : [Math.min(0, min), Math.max(0, max)];
  const pad = (max - min) * 0.05;
  return [min === 0 ? 0 : min - pad, max + pad];
}

export interface Point {
  x: number;
  y: number | null;
}

/** Polyline path with gaps. A null y breaks the line rather than
 *  interpolating across it, because a missing day is not a straight walk
 *  between its neighbours: the first year of history has no year-ago
 *  comparison at all, and drawing that as a line would invent it. */
export function linePath(points: Point[]): string {
  let path = "";
  let penDown = false;
  for (const { x, y } of points) {
    if (y === null || !Number.isFinite(y)) {
      penDown = false;
      continue;
    }
    path += `${penDown ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    penDown = true;
  }
  return path;
}

/** Index of the point nearest a pixel x. Used by the crosshair: the
 *  reader aims at a moment in time, not at a 2px line, so the tooltip
 *  should answer for whatever is closest rather than demanding a hit. */
export function nearestIndex(xs: number[], target: number): number {
  if (xs.length === 0) return -1;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    const distance = Math.abs(xs[i] - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Rounded-at-one-end bar path: rounded at the data end, square at the
 *  baseline, per the mark spec. A plain rect with a border radius rounds
 *  all four corners, which detaches the bar from its baseline. Handles
 *  negative values (bar runs left/down from zero) so the same helper
 *  draws a diverging chart.
 *
 *  The radius is clamped to half the bar's length as well as half its
 *  thickness: a 3px bar with an 4px radius renders as a lozenge or, in
 *  some engines, inverts into a visible spike. */
export function barPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  side: "top" | "right" | "left" | "bottom",
): string {
  const r = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
  const x1 = x + width;
  const y1 = y + height;
  if (r === 0) return `M${x},${y}H${x1}V${y1}H${x}Z`;

  switch (side) {
    case "top":
      return `M${x},${y1}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x1 - r}A${r},${r} 0 0 1 ${x1},${y + r}V${y1}Z`;
    case "bottom":
      return `M${x},${y}V${y1 - r}A${r},${r} 0 0 0 ${x + r},${y1}H${x1 - r}A${r},${r} 0 0 0 ${x1},${y1 - r}V${y}Z`;
    case "right":
      return `M${x},${y}H${x1 - r}A${r},${r} 0 0 1 ${x1},${y + r}V${y1 - r}A${r},${r} 0 0 1 ${x1 - r},${y1}H${x}Z`;
    default:
      return `M${x1},${y}H${x + r}A${r},${r} 0 0 0 ${x},${y + r}V${y1 - r}A${r},${r} 0 0 0 ${x + r},${y1}H${x1}Z`;
  }
}
