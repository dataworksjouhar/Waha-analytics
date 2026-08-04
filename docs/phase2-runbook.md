# Phase 2 Runbook: Sessions 1 to 8

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
> `get_engine()`. It runs every view from session 1, writes one JSON file
> per view to `app/public/data/`, and writes a `meta.json` carrying the
> client branding and name from `config/client_waha.yml` (currency, primary
> colour, logo) so the frontend never hardcodes those either.
>
> Re-running always overwrites cleanly, no accumulation.
>
> Explain why this lives next to the pipeline but is not part of
> `pipeline/run.py`'s bronze-to-gold orchestration before coding.

**Verify:** run the script, open a couple of the JSON files by hand, confirm
shapes match what a chart component will need (arrays of flat objects, not
nested query result artifacts).

**Commit:** `Phase 2 session 2: static JSON export from gold reporting views`

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

---

## Session 4: Footfall and venue sales

**Brief:**

> Build the footfall and own-venue sales section: daily footfall vs last
> week/last year with weather overlay, footfall-to-sales conversion, event
> ROI, average transaction value by venue (metrics 1, 2, 7, 10). Reads
> `vw_footfall_daily`, `vw_footfall_sales_conversion`, `vw_event_roi`,
> `vw_avg_transaction_value` via their exported JSON.

**Verify:** does the winter peak and summer trough actually show up on
screen? Does the planted event-that-lost-money insight (architecture doc
section 8) surface here?

**Commit:** `Phase 2 session 4: footfall and venue sales dashboard section`

---

## Session 5: Leasing and tenants

**Brief:**

> Build the leasing section: turnover rent owed vs collected, sales per
> square metre by category, tenant compliance (metrics 3, 4). Reads
> `vw_tenant_turnover_rent`, `vw_tenant_sales_per_sqm`,
> `vw_tenant_compliance`.

**Verify:** does the planted under-reporting tenant (architecture doc
section 8) stand out against category peers?

**Commit:** `Phase 2 session 5: leasing and tenant dashboard section`

---

## Session 6: Bookings and web

**Brief:**

> Build the online channel section: online vs walk-in ticket mix, website
> conversion rate by channel (metrics 5, 6). Reads `vw_ticket_channel_mix`,
> `vw_web_channel_conversion`.

**Verify:** does the planted collapsing-conversion paid-social channel show
up?

**Commit:** `Phase 2 session 6: bookings and web channel dashboard section`

---

## Session 7: Membership and equestrian

**Brief:**

> Build the recurring-revenue and equestrian section: membership active base
> and churn, revenue mix (own venues vs rental vs membership MRR), lesson
> utilization and no-show rate by level/instructor, stable occupancy
> (metrics 8, 9, 11, 12). Reads `vw_membership_active_churn`,
> `vw_revenue_summary`, `vw_lesson_utilization`, `vw_stable_occupancy`.

**Verify:** does the planted beginner-slots-full/advanced-slots-empty
pattern show up in the utilization view?

**Commit:** `Phase 2 session 7: membership and equestrian dashboard section`

---

## Session 8: Trust, polish and deploy

**Brief:**

> - A trust/data-quality section surfacing `dq.check_results`: what gets
>   flagged and why, same principle as the pipeline, nothing hidden.
> - Insights copy: plain-language findings next to the relevant charts.
> - Responsive pass, mobile layout.
> - Update `README.md` with the dashboard, screenshots, how to run it.
> - Deploy the static app (Vercel/Netlify, static hosting only, no server).

**Commit:** `Phase 2 session 8: trust panel, polish and deploy`

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
| 2 | Static export script | | |
| 3 | React scaffold | | |
| 4 | Footfall and venue sales | | |
| 5 | Leasing and tenants | | |
| 6 | Bookings and web | | |
| 7 | Membership and equestrian | | |
| 8 | Trust, polish, deploy | | |

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
