/* Loading the exported gold data.
 *
 * Every file here is written by pipeline/export_dashboard_data.py from the
 * reporting views in sql/. Nothing in the frontend queries Postgres: the
 * database is a free-tier instance that pauses when idle, and a public page
 * holding database credentials is a problem with no upside when the data is
 * synthetic and fixed. For a real client this module is the one that would
 * change, swapping fetch-a-file for fetch-an-endpoint, and no component
 * above it would notice.
 */

// BASE_URL rather than a hardcoded "/data/...", so the app still finds its
// data when a static host serves it from a subpath instead of the root.
const dataUrl = (name: string) => `${import.meta.env.BASE_URL}data/${name}.json`;

export async function loadJson<T>(name: string): Promise<T> {
  const response = await fetch(dataUrl(name));
  if (!response.ok) {
    throw new Error(`Could not load ${name}.json (HTTP ${response.status})`);
  }
  return (await response.json()) as T;
}

/** Awaits an object of promises and gives back an object of their results,
 *  keys and types intact.
 *
 *  Promise.all takes a positional tuple, and the dashboard loads a file
 *  per reporting view, with more arriving each session. Reassembling that
 *  many results by position is a bug waiting for the next file to be
 *  inserted in the middle: every export is an array of objects, so a
 *  mis-ordered pair type-checks happily and only fails once it is on
 *  screen. Keying the load makes that mistake a compile error instead.
 *
 *  Object.keys and Object.values walk string keys in the same insertion
 *  order, which is what makes the zip below safe. That is specified
 *  behaviour, not an implementation detail to hope about. */
export async function loadAll<T extends Record<string, Promise<unknown>>>(
  sources: T,
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  // The promises are already running: building `sources` started every
  // fetch. This only waits, so the files still load in parallel.
  const keys = Object.keys(sources) as (keyof T)[];
  const settled = await Promise.all(Object.values(sources));
  const result = {} as { [K in keyof T]: Awaited<T[K]> };
  keys.forEach((key, index) => {
    result[key] = settled[index] as Awaited<T[typeof key]>;
  });
  return result;
}

/** meta.json: client identity and branding, sourced from config/client_waha.yml. */
export interface Meta {
  client: {
    name: string;
    /** the physical site, as distinct from the operating company */
    site_name: string;
    short_name: string;
    currency: string;
    timezone: string;
    weekend: string[];
  };
  branding: {
    primary_color: string | null;
    logo: string | null;
  };
  date_range: { start: string; end: string };
  metrics_enabled: string[];
  generated_at: string;
  row_counts: Record<string, number>;
}

/** One row of gold.vw_footfall_daily. Nullable fields are genuinely absent
 *  rather than zero: the first year of history has no year-ago comparison,
 *  and conflating "no data" with "zero visitors" would be a lie the season
 *  ribbon then draws. */
export interface FootfallDay {
  date_key: number;
  full_date: string;
  season: string;
  is_weekend: boolean;
  is_ramadan: boolean;
  footfall: number;
  has_imputed_hours: boolean;
  has_corrected_hours: boolean;
  footfall_week_ago: number | null;
  footfall_year_ago: number | null;
  temp_max_c: number | null;
  temp_min_c: number | null;
  dust_storm_flag: boolean;
  rain_mm: number | null;
}
