/* The dashboard shell: loads the exported data once, holds the season
 * filter and the active section, and renders whichever section is showing.
 *
 * State lives here rather than in a store: there are two pieces of it (the
 * date range and the current section) and one consumer tree. Reaching for
 * Redux or Zustand at this size would be architecture for its own sake.
 */

import { useEffect, useMemo, useState } from "react";
import { FootfallSales } from "./components/FootfallSales";
import { Leasing } from "./components/Leasing";
import { SeasonRibbon } from "./components/SeasonRibbon";
import { SectionPlaceholder } from "./components/SectionPlaceholder";
import { SitePlan } from "./components/SitePlan";
import { loadAll, loadJson, type FootfallDay, type Meta } from "./lib/data";
import type { EventRoi, VenueAtv, VenueConversion, ZoneFootfall } from "./lib/footfall";
import type { TenantCompliance, TenantRentMonth, TenantSqmMonth } from "./lib/leasing";
import { deriveMonths, type DateRange } from "./lib/months";
import type { GateHourFootfall, SitePlanData, TenantSiteMetric } from "./lib/sitePlan";
import { SECTIONS } from "./sections";

/** Everything the dashboard reads, loaded in one pass. Held as a single
 *  object rather than one useState per file so the render either has all
 *  of it or none: a partially-arrived dashboard would flash charts in one
 *  at a time and shift the layout under the reader. */
interface Bundle {
  meta: Meta;
  days: FootfallDay[];
  plan: SitePlanData;
  tenantMetrics: TenantSiteMetric[];
  gateFootfall: GateHourFootfall[];
  conversion: VenueConversion[];
  events: EventRoi[];
  atv: VenueAtv[];
  zones: ZoneFootfall[];
  rent: TenantRentMonth[];
  perSqm: TenantSqmMonth[];
  compliance: TenantCompliance[];
}

export default function App() {
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [range, setRange] = useState<DateRange | null>(null);
  const [sectionId, setSectionId] = useState(SECTIONS[0].id);

  useEffect(() => {
    /* Each Bundle field is named alongside the export it comes from, so
     * the pairing is checked by the compiler rather than by counting
     * positions. See loadAll in lib/data.ts for why. */
    loadAll({
      meta: loadJson<Meta>("meta"),
      days: loadJson<FootfallDay[]>("vw_footfall_daily"),
      plan: loadJson<SitePlanData>("site_plan"),
      tenantMetrics: loadJson<TenantSiteMetric[]>("vw_tenant_site_metrics"),
      gateFootfall: loadJson<GateHourFootfall[]>("vw_footfall_gate_hour_monthly"),
      conversion: loadJson<VenueConversion[]>("vw_footfall_sales_conversion"),
      events: loadJson<EventRoi[]>("vw_event_roi"),
      atv: loadJson<VenueAtv[]>("vw_avg_transaction_value"),
      zones: loadJson<ZoneFootfall[]>("vw_footfall_by_zone"),
      rent: loadJson<TenantRentMonth[]>("vw_tenant_turnover_rent"),
      perSqm: loadJson<TenantSqmMonth[]>("vw_tenant_sales_per_sqm"),
      compliance: loadJson<TenantCompliance[]>("vw_tenant_compliance"),
    })
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // Branding is applied as a CSS custom property so every rule in
  // index.css that uses var(--brand) picks it up. The client's colour
  // arrives from config via meta.json; it is never written into a
  // stylesheet or a component.
  useEffect(() => {
    if (data?.meta.branding.primary_color) {
      document.documentElement.style.setProperty("--brand", data.meta.branding.primary_color);
    }
    if (data) {
      document.title = `${data.meta.client.name} - Analytics`;
    }
  }, [data]);

  const months = useMemo(() => (data ? deriveMonths(data.days) : []), [data]);
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

  if (!data) {
    return <div className="state">Loading...</div>;
  }

  const { meta } = data;

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
        {section.id === "site" ? (
          <SitePlan
            plan={data.plan}
            tenantMetrics={data.tenantMetrics}
            gateFootfall={data.gateFootfall}
            months={months}
            range={range}
            currency={meta.client.currency}
          />
        ) : section.id === "footfall" ? (
          <FootfallSales
            days={data.days}
            conversion={data.conversion}
            events={data.events}
            atv={data.atv}
            zones={data.zones}
            range={range}
            currency={meta.client.currency}
          />
        ) : section.id === "leasing" ? (
          <Leasing
            rent={data.rent}
            perSqm={data.perSqm}
            compliance={data.compliance}
            days={data.days}
            range={range}
            currency={meta.client.currency}
          />
        ) : (
          <SectionPlaceholder section={section} />
        )}
      </main>
    </div>
  );
}
