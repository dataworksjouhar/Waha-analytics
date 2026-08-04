# Phase 2 Runbook: Sessions 1 to 9

Al Waha Analytics. Phase 2 is the dashboard: a React app reading static JSON
exported from the gold layer. Same ritual as Phase 1, one session at a time.

Phase 1 is complete: generator, pipeline, gold star schema, all 12 sessions
done and the exam passed against a freshly rebuilt database. Nothing here
touches `generator/` or `pipeline/`'s bronze-to-gold logic; Phase 2 only adds
a reporting layer on top of gold and a frontend that reads it.

---

## The ritual for every session

**Start:**
```powershell
cd C:\Projects\Waha-analytics
claude
```

**During:** ask for an explanation before code is written, and a walkthrough
after. Same standing rule as Phase 1: nothing gets committed that you cannot
explain in an interview.

**End:**
```powershell
git add .
git status
git commit -m "<message given in each session below>"
git push
```
Always read `git status` before committing. `.env` and `.venv/` must never
appear, and once `app/node_modules/` exists it must be gitignored.

---

## Why static JSON, not a live API

Decided at Phase 2 kickoff: the React app never queries Postgres directly.
A Python export script (Session 2) runs the reporting views built in
Session 1 and writes JSON files the app reads at build/runtime. Reasoning:

- The free-tier Supabase database pauses after inactivity. A recruiter or
  interviewer opening the dashboard cold would otherwise hit a slow wake-up
  or an error.
- A public frontend holding live database credentials is a security
  conversation worth avoiding on a portfolio site.
- The data is synthetic and fixed, so there is nothing that needs a live
  refresh.

For a real client, the same React components would point at a live API
instead. That swap is a data-fetching layer change, not a redesign, which is
itself worth being able to say in an interview.

---

## Session 1: SQL reporting views

The views the dashboard is actually built on. Pure SQL, no new tooling.

**Brief:**

> Start Phase 2, session 1: reporting views on the gold layer.
>
> Build four SQL files in `sql/`, each a group of `CREATE OR REPLACE VIEW`
> statements against `gold` schema tables, one view per one of the 12 locked
> metrics (architecture doc section 9):
>
> - `sql/01_footfall_and_sales.sql`: daily footfall with week-ago/year-ago
>   comparison and weather overlay (metric 1), footfall-to-sales conversion
>   for own venues (metric 2), event ROI vs a trailing baseline (metric 7),
>   average transaction value by venue (metric 10)
> - `sql/02_tenants.sql`: turnover rent owed vs collected (metric 3), sales
>   per square metre by category (metric 4), a tenant submission compliance
>   view (days late, restatement rate) supporting metric 3
> - `sql/03_bookings_and_web.sql`: online vs walk-in ticket mix (metric 5),
>   website conversion rate by channel (metric 6)
> - `sql/04_membership_and_equestrian.sql`: membership active base and churn
>   (metric 8), a revenue summary of own-venue sales vs rental income vs
>   membership MRR (metric 9), riding lesson utilization and no-show rate by
>   level and instructor (metric 11), stable occupancy and boarding revenue
>   (metric 12)
>
> All views `CREATE OR REPLACE`, so re-applying is always safe. Plain ANSI
> SQL, window functions where needed for period comparisons. No new schema,
> everything reads from `gold`.
>
> Explain each view's logic before writing it.

**Verify:** apply all four files against the live Supabase gold schema, then
`SELECT * FROM gold.vw_<name> LIMIT 20` on each and eyeball the numbers.
Cross-check one metric by hand, for example `vw_tenant_sales_per_sqm` for one
tenant you already know, against `dim_tenant.unit_sqm` and a manual sum of
`fact_tenant_sales`.

**Commit:** `Phase 2 session 1: gold reporting views for the 12 locked metrics`

---

## Session 2: Static export script

**Brief:**

> Start Phase 2, session 2: the static JSON export.
>
> Build `pipeline/export_dashboard_data.py`, reusing `pipeline/db.py`'s
> `get_engine()`. It applies the session 1 view files, runs every view,
> writes one JSON file per view to `app/public/data/`, and writes a
> `meta.json` carrying the client branding and name from
> `config/client_waha.yml` (currency, primary colour, logo) so the frontend
> never hardcodes those either.
>
> Which views get exported is driven by `metrics.enabled` in the config, not
> by a hardcoded list, so turning a metric off for a client is a YAML edit.
>
> Re-running always overwrites cleanly, no accumulation.
>
> Explain why this lives next to the pipeline but is not part of
> `pipeline/run.py`'s bronze-to-gold orchestration before coding.

**Verify:** run the script, open a couple of the JSON files by hand, confirm
shapes match what a chart component will need (arrays of flat objects, not
nested query result artifacts).

**Commit:** `Phase 2 session 2: static JSON export from gold reporting views`

**Two decisions made during this session, worth being able to defend:**

- `dq.check_results` is exported here (`dq_summary.json`) rather than in
  session 8, even though session 8 is where it gets displayed. Anything
  that comes out of the database belongs in the export script; session 8
  stays purely frontend work.
- `app/public/data/*.json` is committed, not gitignored, which looks wrong
  next to `data/bronze/` being ignored. The reason is the deployment model:
  the static host builds with no database credentials, so uncommitted
  export output means nothing to deploy.

---

## Session 3: React scaffold

**Brief:**

> Start Phase 2, session 3: the React app shell.
>
> Vite + React + TypeScript + Recharts in `app/`. Layout shell with
> navigation between the metric sections used in sessions 4 to 7, a
> season/date-range filter component (the dashboard's central idea: this
> business is decided by season), and branding pulled from `meta.json` at
> load, not hardcoded. No metric content yet, just the shell rendering
> against real exported data.
>
> Explain the component structure before coding.

**Verify:** `npm run dev`, confirm the shell loads, branding colour and
client name come from config, nav links exist even if the pages are empty.

**Commit:** `Phase 2 session 3: React app scaffold and config-driven shell`

**The colour decision, worth being able to defend:** the season ribbon uses
a single-hue ordinal ramp (light to dark = trough to shoulder to peak),
not three unrelated colours. Peak, shoulder and trough are ordered by
trading intensity, so darker reading as stronger season is information the
reader gets without consulting the legend. The three steps were checked
with a palette validator for lightness banding, step separation and
contrast against the actual surface in both light and dark mode, rather
than picked by eye. Dark mode reverses the ramp: on a dark surface the
weakest season is the step nearest the surface.

`--brand` (the client colour from config) is chrome only: masthead mark,
active nav underline, focus rings. It never encodes data, because a client
whose brand colour is red must not end up with red meaning "good".

---

## Session 4: Site plan

Added mid-phase. In the AJRE interview the GM pointed at a large site map on
his wall and asked whether reporting could cover all of it. This is the
answer to that question.

**What it builds:** an interactive schematic of the park as the landing
view. Tenant plots sized true to `dim_tenant.unit_sqm`, fill switching
between sales per sqm, reported sales, rent owed and days late, gates sized
by footfall with an hour scrubber, click to select a unit.

**Why a map earns its place, beyond the moment.** Two encodings on one
mark: plot size is floor area, fill is the selected metric. A large unit
trading weakly is a big pale rectangle your eye finds first; in a table it
is just another row. Sales per square metre is an inherently spatial
measure, and a vacancy is a hole in a terrace. The closed unit (U-112, Al
Reef Bakery) is hatched rather than coloured, because a vacancy is not "the
lowest value on the scale", it is the absence of a tenant.

**The decision worth defending: it is a schematic, not a traced map.**
Al Waha is inspired by real Kuwaiti operators but is never branded as one.
Putting invented tenant names and invented turnover rent onto a real
operator's actual footprint would collapse that separation: the demo would
read as fabricated data about an identifiable company, and it would be
built on copyrighted satellite imagery. The schematic keeps the fiction
intact and still reads as a real destination. A future client's true layout
replaces the coordinates in `config/client_waha.yml` and nothing else,
which is the template argument made physical: you can redraw the map as
their site, live, in a meeting.

**The layout is not invented from nothing.** The seed data already implied
it: unit numbering clusters into a `U-1xx` F&B block and a `U-2xx` retail
block. Zoning is owner-provided, describing how destinations of this kind
are actually laid out in Kuwait, west to east: the leased retail and cafes
run north-south along the western boundary between the two western gates,
the farm sits just inside that strip, the large open leisure area is
central, and the arena, equestrian and sports facilities are east.

**A constraint discovered while building it, worth being able to explain.**
Gate names cannot be changed. `pipeline/transform/footfall.py` carries an
alias table mapping `"North Gate" -> G02`, and the generator writes those
names into two years of raw footfall files, so renaming a gate means
regenerating the source data. The positions therefore honour both the real
topology and the names the warehouse already uses: the two western gates
bracket the retail strip north and south, the two eastern gates sit on the
north-east and south-east corners. Gate descriptions in
`data/seeds/gates.csv` were updated to match; `dim_gate` still carries the
old text until the next full `python -m pipeline.run`, because
`dim_simple.transform_gate` truncates with `cascade=True` and a dims-only
rerun would take `fact_footfall` with it. Nothing surfaces the stale value:
the gate tooltip shows a computed busiest hour instead, which is more
useful than static text anyway.

**Colour:** the fill ramp is orange, not blue, because the season ribbon is
already a blue scale on the same screen. Validated as an ordinal ramp in
both modes so the palest step still reads as filled rather than as an empty
plot. The legend says "low to high" rather than naming a colour, because
the ramp reverses between light and dark mode.

**Commit:** `Phase 2 session 4: interactive site plan`

---

## Session 5: Footfall and venue sales

**Brief:**

> Build the footfall and own-venue sales section: daily footfall vs last
> week/last year with weather overlay, footfall-to-sales conversion, event
> ROI, average transaction value by venue (metrics 1, 2, 7, 10). Reads
> `vw_footfall_daily`, `vw_footfall_sales_conversion`, `vw_event_roi`,
> `vw_avg_transaction_value` via their exported JSON.

**Verify:** does the winter peak and summer trough actually show up on
screen? Does the planted event-that-lost-money insight (architecture doc
section 8) surface here?

**Commit:** `Phase 2 session 5: footfall and venue sales dashboard section`

---

## Session 6: Leasing and tenants

**Brief:**

> Build the leasing section: turnover rent owed vs collected, sales per
> square metre by category, tenant compliance (metrics 3, 4). Reads
> `vw_tenant_turnover_rent`, `vw_tenant_sales_per_sqm`,
> `vw_tenant_compliance`.

**Verify:** does the planted under-reporting tenant (architecture doc
section 8) stand out against category peers?

**Commit:** `Phase 2 session 6: leasing and tenant dashboard section`

---

## Session 7: Bookings and web

**Brief:**

> Build the online channel section: online vs walk-in ticket mix, website
> conversion rate by channel (metrics 5, 6). Reads `vw_ticket_channel_mix`,
> `vw_web_channel_conversion`.

**Verify:** does the planted collapsing-conversion paid-social channel show
up?

**Not with the session 1 views, it did not.** Both are whole-history
aggregates with no date column, and a collapse is a shape over time. The
headline rate said paid_social converts worse than organic, which is a
different and much weaker claim than paid_social is getting worse while
everything else improves. Session 7 therefore added
`gold.vw_web_channel_conversion_monthly` alongside the existing view
rather than replacing it: the aggregate is still the right denominator
for "what did this channel deliver", and summing the monthly rows to get
it back would invite someone to average twenty-four monthly percentages,
which is not the same number.

`vw_ticket_channel_mix` also gained `venue_key` and `venue_name` for
metric 5. The booking website sells one ticket per venue while the till
sells adult, child and family, so at SKU grain the online share is an
artifact of the crosswalk in `pipeline/load/fact_bookings.py`. Venue plus
category is where the two channels are comparable.

Worth remembering as a pattern rather than a one-off: a reporting view
that answers a metric's wording can still fail the question behind it.
Check what grain the insight needs before building the chart.

**Commit:** `Phase 2 session 7: bookings and web channel dashboard section`

---

## Session 8: Membership and equestrian

**Brief:**

> Build the recurring-revenue and equestrian section: membership active base
> and churn, revenue mix (own venues vs rental vs membership MRR), lesson
> utilization and no-show rate by level/instructor, stable occupancy
> (metrics 8, 9, 11, 12). Reads `vw_membership_active_churn`,
> `vw_revenue_summary`, `vw_lesson_utilization`, `vw_stable_occupancy`.

**Verify:** does the planted beginner-slots-full/advanced-slots-empty
pattern show up in the utilization view?

**Commit:** `Phase 2 session 8: membership and equestrian dashboard section`

---

## Session 9: Trust, polish and deploy

**Brief:**

> - A trust/data-quality section surfacing `dq.check_results`: what gets
>   flagged and why, same principle as the pipeline, nothing hidden.
> - Insights copy: plain-language findings next to the relevant charts.
> - Responsive pass, mobile layout.
> - Update `README.md` with the dashboard, screenshots, how to run it.
> - Deploy the static app (Vercel/Netlify, static hosting only, no server).

**Commit:** `Phase 2 session 9: trust panel, polish and deploy`

---

## Phase 2 definition of done

- [ ] All 12 locked metrics from architecture doc section 9 render from real
      gold data via static JSON, no live DB calls from the browser
- [ ] Every planted insight (under-reporting tenant, event that lost money,
      collapsing paid-social channel, beginner/advanced lesson imbalance) is
      visible somewhere in the dashboard, not just in the data
- [ ] Data quality flags are surfaced, not hidden
- [ ] Branding and client name are config-driven, not hardcoded in React
- [ ] You can explain every file without notes
- [ ] Deployed and reachable at a public URL
- [ ] README updated as the portfolio front door

---

## Progress tracker

| Session | Topic | Done | Committed |
|---|---|---|---|
| 1 | SQL reporting views | yes | yes |
| 2 | Static export script | yes | yes |
| 3 | React scaffold | yes | yes |
| 4 | Site plan | yes | yes |
| 5 | Footfall and venue sales | yes | yes |
| 6 | Leasing and tenants | yes | yes |
| 7 | Bookings and web | yes | yes |
| 8 | Membership and equestrian | | |
| 9 | Trust, polish, deploy | | |

---

## Notes for later

Bring any of these back to the design chat rather than solving them alone in
Claude Code:

- A design decision you cannot justify
- A chart or number that does not match the underlying gold data
- Anything that requires a code change where it should be a config change
- Scope creep pressure (auth, live API, ML forecasting) before Phase 2 is
  done
- The old HTML dashboard prototype built in a separate Claude.ai conversation
  (season ribbon, spatial site plan, trust modal, v1-v4 version history,
  documented in `docs/al-waha-project-reference.md` part 7) was deliberately
  set aside at Phase 2 kickoff in favour of designing fresh from the locked
  metrics. Revisit it for UI ideas once the real data is on screen, but it
  is not the spec.
