/* Turning the daily footfall rows into the 24 month cells the season
 * ribbon draws.
 *
 * The season label is not recomputed here from a hardcoded "October to
 * March" rule. It is read off gold.dim_date, which the pipeline populated
 * from config/client_waha.yml's calendar section. A client in a different
 * market with a different peak season therefore changes their YAML, and
 * this ribbon recolours itself with no code change. Duplicating the season
 * rule in TypeScript would quietly break that promise. */

import type { FootfallDay } from "./data";

export interface MonthCell {
  /** first day of the month, ISO, e.g. "2024-07-01" */
  monthStart: string;
  /** last day of the month present in the data, ISO */
  monthEnd: string;
  /** the season that covers most days of the month */
  season: string;
  dayCount: number;
}

const monthKey = (isoDate: string) => isoDate.slice(0, 7);

export function deriveMonths(days: FootfallDay[]): MonthCell[] {
  const buckets = new Map<string, { dates: string[]; seasons: Map<string, number> }>();

  for (const day of days) {
    const key = monthKey(day.full_date);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { dates: [], seasons: new Map() };
      buckets.set(key, bucket);
    }
    bucket.dates.push(day.full_date);
    bucket.seasons.set(day.season, (bucket.seasons.get(day.season) ?? 0) + 1);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucket]) => {
      const dates = bucket.dates.sort();
      // A month straddling a season boundary (October, March) gets the
      // season that owns most of its days rather than whichever day
      // happened to sort first.
      const [season] = [...bucket.seasons.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        monthStart: `${key}-01`,
        monthEnd: dates[dates.length - 1],
        season,
        dayCount: dates.length,
      };
    });
}

export interface DateRange {
  start: string;
  end: string;
}

/** Inclusive ISO date comparison. ISO dates sort lexicographically, which
 *  is exactly why the exporter writes them as strings rather than as
 *  timestamps: no timezone can shift a date across midnight on the way in. */
export const isWithin = (isoDate: string, range: DateRange | null) =>
  range === null || (isoDate >= range.start && isoDate <= range.end);

export const rangeFromMonths = (months: MonthCell[]): DateRange | null =>
  months.length === 0
    ? null
    : { start: months[0].monthStart, end: months[months.length - 1].monthEnd };
