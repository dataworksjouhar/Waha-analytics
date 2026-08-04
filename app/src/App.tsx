/* The dashboard shell: loads the exported data once, holds the season
 * filter and the active section, and renders whichever section is showing.
 *
 * State lives here rather than in a store: there are two pieces of it (the
 * date range and the current section) and one consumer tree. Reaching for
 * Redux or Zustand at this size would be architecture for its own sake.
 */

import { useEffect, useMemo, useState } from "react";
import { SeasonRibbon } from "./components/SeasonRibbon";
import { SectionPlaceholder } from "./components/SectionPlaceholder";
import { loadJson, type FootfallDay, type Meta } from "./lib/data";
import { deriveMonths, type DateRange } from "./lib/months";
import { SECTIONS } from "./sections";

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [days, setDays] = useState<FootfallDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [range, setRange] = useState<DateRange | null>(null);
  const [sectionId, setSectionId] = useState(SECTIONS[0].id);

  useEffect(() => {
    Promise.all([loadJson<Meta>("meta"), loadJson<FootfallDay[]>("vw_footfall_daily")])
      .then(([loadedMeta, loadedDays]) => {
        setMeta(loadedMeta);
        setDays(loadedDays);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Branding is applied as a CSS custom property so every rule in
  // index.css that uses var(--brand) picks it up. The client's colour
  // arrives from config via meta.json; it is never written into a
  // stylesheet or a component.
  useEffect(() => {
    if (meta?.branding.primary_color) {
      document.documentElement.style.setProperty("--brand", meta.branding.primary_color);
    }
    if (meta) {
      document.title = `${meta.client.name} - Analytics`;
    }
  }, [meta]);

  const months = useMemo(() => (days ? deriveMonths(days) : []), [days]);
  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];

  if (error) {
    return (
      <div className="state state--error">
        <strong>Could not load dashboard data.</strong>
        <p>{error}</p>
        <p className="card__note">
          Run <code>python -m pipeline.export_dashboard_data</code> to regenerate
          <code> app/public/data/</code>.
        </p>
      </div>
    );
  }

  if (!meta || !days) {
    return <div className="state">Loading...</div>;
  }

  return (
    <div className="app">
      <header className="masthead">
        <span className="masthead__mark" aria-hidden="true" />
        <div className="masthead__titles">
          <h1>{meta.client.name}</h1>
          <div className="masthead__sub">
            {meta.date_range.start} to {meta.date_range.end} &middot; all figures in{" "}
            {meta.client.currency} &middot; synthetic data
          </div>
        </div>
      </header>

      <nav className="nav" aria-label="Dashboard sections">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav__item"
            aria-current={item.id === sectionId ? "page" : undefined}
            onClick={() => setSectionId(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="main">
        <SeasonRibbon months={months} range={range} onRangeChange={setRange} />
        <SectionPlaceholder section={section} />
      </main>
    </div>
  );
}
