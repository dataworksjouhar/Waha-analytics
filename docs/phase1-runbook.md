# Phase 1 Runbook: Sessions 2 to 12

Al Waha Analytics. Work through these one at a time, in order. Each session is self contained: open Claude Code, give it the brief, review what it builds, verify, commit.

Session 1 is complete (config model, master data seeds, schema DDL, seasonality rules).

---

## The ritual for every session

**Start:**
```powershell
cd C:\Projects\Waha-analytics
claude
```
(Or Ctrl + backtick inside VS Code, which lands you in the right folder automatically.)

**During:** ask for an explanation before code is written, and a walkthrough after. The standing rule holds: nothing gets committed that you cannot explain in an interview.

**End:**
```powershell
git add .
git status
git commit -m "<message given in each session below>"
git push
```
Always read `git status` before committing. `.env` and `.venv/` must never appear.

**If a session ends badly:** `claude --continue` resumes the last conversation with context intact.

---

# WEEK 1: THE GENERATOR

The goal of week 1 is a `generator/generate.py` that produces two years of realistic, deliberately imperfect source files into `data/bronze/`.

---

## Session 2: Calendar and seasonality engine

The most important session in week 1. Everything downstream inherits these assumptions.

**Brief:**

> Start Phase 1, session 2: the calendar and seasonality engine.
>
> Build the date spine and seasonality model that every other generator depends on. Requirements:
>
> - Daily calendar covering July 2024 to July 2026, with Kuwaiti weekend flags (Friday and Saturday), Ramadan date ranges for both years, public holidays including National and Liberation Day, school holiday periods, and a season label.
> - Separate seasonality curves per venue type as specified in CLAUDE.md, not one shared factor. Park, equestrian lessons, boarding, and gym each behave differently.
> - All seasonality factors, curve shapes and calendar dates live in config/client_waha.yml, not hardcoded in Python.
> - Deterministic random seed so output is reproducible.
> - An hourly weight curve, evening weighted, with a different shape during Ramadan.
>
> Explain the design before writing code, then walk me through each file after.

**Review:** does the design hold up under interview questioning, and would an AJRE person recognise these patterns as real?

**Verify:** ask it to print monthly index values per venue type across all 24 months. Check with your own eyes:
- Park peaks mid-October to March, collapses June to August
- Equestrian dips modestly July and August, does not collapse
- Boarding essentially flat
- Gym mild, small January bump
- Ramadan shifts the hourly curve rather than flattening the daily total

**Critical check:** changing any curve must be a config edit, never a Python edit. If it requires touching code, the config model is wrong. Fix it now, not in week 2.

**Commit:** `Phase 1 session 2: calendar spine and per-venue seasonality engine`

---

## Session 3: Weather and footfall

**Brief:**

> Start Phase 1, session 3: weather and footfall generators.
>
> - Weather: daily temp max and min for Kuwait, realistic annual curve (summer highs around 50C, winter mild), dust storm flags concentrated in spring, occasional rain in winter months.
> - Footfall: hourly counts per gate for four gates, driven by the seasonality engine from session 2, then modulated by weather (extreme heat and dust storms suppress footfall), events, weekends, and hourly curve. Include realistic noise so it is not mechanically smooth.
> - Output as separate daily CSV files per source, in the formats defined in the architecture doc section 3.
> - Do not inject imperfections yet, that comes in session 6. Generate clean data for now.
>
> Explain the causal model before coding.

**Verify:** ask for a plot or printed table of daily footfall for one full year. It should look like a real venue: weekend spikes, summer trough, event peaks, weather dips. If the line looks too smooth or too random, say so.

**Commit:** `Phase 1 session 3: weather and footfall generators`

---

## Session 4: POS sales, bookings and web sessions

**Brief:**

> Start Phase 1, session 4: transactional generators for own-operated venues.
>
> - POS sales in D365 F&O export shape (see architecture doc section 3, source 1), driven by footfall with a realistic conversion rate and basket size per venue. Playground and Farm tickets, Farm kiosk retail, gym day passes.
> - Bookings from the website: tickets, memberships, lesson packages, event bookings.
> - Web sessions in GA4 export shape, by date, channel and device, leading bookings with a realistic conversion rate per channel.
> - Online versus walk-in split should be plausible and vary by product type.
> - Still no imperfections. Clean data.
>
> Explain how footfall drives sales before coding.

**Review as a retail analyst:** are average transaction values plausible in KWD? Is the conversion rate from footfall to purchase realistic for a destination? Does the online share make sense for Kuwait?

**Commit:** `Phase 1 session 4: POS, bookings and web session generators`

---

## Session 5: Tenant submissions, contracts and lessons

The three trickiest generators. Take your time.

**Brief:**

> Start Phase 1, session 5: tenant, contract and lesson generators.
>
> - Tenant monthly sales submissions: one file per tenant per month, driven by footfall share and category, with tenant-specific performance factors. Plant one tenant whose reported sales are consistently low relative to their footfall share and category peers (the under-reporting insight).
> - Contracts: gym memberships, equestrian club memberships and horse boarding in one structure, with joins, churn and renewals over the two years. Boarding roughly flat year round, gym with a January intake spike.
> - Lessons: riding school schedule with capacity, bookings and attendance, by level and instructor. Plant the pattern where beginner slots run near capacity while advanced slots sit half empty.
> - Format inconsistency across tenant files comes in session 6, but the underlying numbers are generated here.
>
> Explain the approach for each before coding.

**Verify:** confirm both planted insights are actually detectable. Ask it to show the under-reporting tenant's sales-per-footfall against peers, and utilization by lesson level. If you cannot see the pattern in raw numbers, the dashboard will not show it either.

**Commit:** `Phase 1 session 5: tenant submissions, contracts and lesson generators`

---

## Session 6: Imperfection injection and full run

**Brief:**

> Start Phase 1, session 6: mess.py and the full generation run.
>
> Build a mess.py module that injects the deliberate imperfections listed in the architecture doc section 3, each behind an on/off toggle in config:
>
> - Footfall: one sensor dead for 48 hours (nulls), another double-counting for a period, gate names inconsistent across files (Gate 1, GATE_1, G1)
> - POS: duplicate invoice lines from re-export overlap, negative quantities for refunds
> - Tenant submissions: varying column names (gross_sales vs net_sales vs both), varying date formats, one tenant reporting weekly rows, submissions 5 to 40 days late, roughly one in ten later restated as a second file
> - Contracts: null end dates for open-ended contracts, a few cancellation dates before start dates, duplicate member identities across gym and equestrian systems resolvable on phone number
> - Lessons: missing attendance values, occasional bookings above capacity
> - Events: one event with end date before start date
>
> Then wire generator/generate.py as the single entry point that produces all two years of bronze files. It must be reproducible from the seed.

**Verify:** run `python generator/generate.py`, then open several bronze files by hand. They should look like files a real client would email you: inconsistent, imperfect, believable. Confirm the run takes seconds or a couple of minutes, not hours.

**Commit:** `Phase 1 session 6: imperfection injection and full generation run`

**Week 1 done.** Take stock. You now have a realistic messy source estate.

---

# WEEK 2: THE PIPELINE

The goal of week 2 is `pipeline/run.py` taking those messy files through bronze, silver and gold, with data quality results recorded.

---

## Session 7: Schema deployment and bronze extract

**Brief:**

> Start Phase 1, session 7: deploy schemas and build the bronze extract layer.
>
> - Apply the DDL in config/schema/ to the Supabase Postgres database, creating the bronze, silver, gold and dq schemas.
> - Build the extract layer: scan data/bronze/, register every file in a bronze file registry table (filename, source type, load timestamp, row count, checksum), and load raw contents to bronze tables with no transformation applied.
> - Must be idempotent: re-running does not duplicate rows.
> - Read the connection string from .env, never hardcoded.
>
> Explain the bronze layer's purpose and why nothing is cleaned here.

**Verify:** connect through the Supabase table editor or VS Code and confirm the schemas and tables exist with data in them. Run the extract twice and confirm row counts do not double.

**Commit:** `Phase 1 session 7: schema deployment and bronze extract layer`

---

## Sessions 8 and 9: Silver transforms

The heaviest work, split across two sessions. This is what interviewers probe hardest.

**Session 8 brief (structured sources):**

> Start Phase 1, session 8: silver transforms for structured sources.
>
> Conform, type, deduplicate and quality-flag: POS sales, footfall, web sessions, bookings, weather and events. For each:
> - Correct data types, timezone handling, currency
> - Deduplicate re-exported POS lines on a defined business key
> - Conform gate names to a single standard
> - Handle the dead sensor with an explicit imputation strategy and an is_imputed flag
> - Handle the double-counting sensor with an outlier rule and a flag
> - Keep refunds as negative rows, never drop them
> - Every silver table carries _source_file, _loaded_at and _dq_flags
>
> Explain each cleaning decision and its business justification before coding.

**Session 9 brief (messy sources):**

> Start Phase 1, session 9: silver transforms for the messy sources.
>
> - Tenant submissions: conform varying column names, date formats and weekly versus monthly rows into one tenant-month grain. Track submitted_date, submission_version, days_late and a restated flag. Keep all versions; a view exposes the current one.
> - Contracts: infer churn where end_date is null, flag cancellation dates before start dates, resolve duplicate member identities across systems on phone number.
> - Lessons: handle missing attendance and flag overbooked slots.
>
> Nothing is silently dropped. Everything questionable is flagged and reported.

**Verify after each:** query the silver tables directly in SQL. This is your home ground. Check row counts against bronze, spot check the flags, confirm the imputed footfall values look sensible.

**Commits:**
`Phase 1 session 8: silver transforms for structured sources`
`Phase 1 session 9: silver transforms for tenant, contract and lesson data`

---

## Session 10: Gold dimensions

**Brief:**

> Start Phase 1, session 10: build the gold dimensions.
>
> Per the architecture doc section 5: dim_date (with weather extension), dim_tenant as SCD Type 2, dim_venue, dim_gate, dim_product, dim_customer, dim_member, dim_stable, dim_instructor, dim_event, dim_channel.
>
> dim_tenant must correctly version the tenant that changes category and the tenant that closes, with valid_from, valid_to and is_current. Surrogate keys throughout.
>
> Explain the SCD Type 2 implementation carefully, including how late-arriving changes would be handled.

**Verify:** this is your SCD test. Query `dim_tenant` for the tenant that changed category and confirm two rows exist with correct date ranges and exactly one marked current. Re-run the load and confirm no duplicate versions appear.

**Commit:** `Phase 1 session 10: gold dimension build with SCD Type 2`

---

## Session 11: Gold facts

**Brief:**

> Start Phase 1, session 11: build the gold fact tables.
>
> All seven: fact_pos_sales (invoice line), fact_footfall (gate x hour), fact_tenant_sales (tenant x month x version), fact_bookings (booking), fact_web_sessions (date x channel x device), fact_membership_months (contract x month, periodic snapshot with is_new, is_churned, mrr_kwd), fact_lesson_slots (lesson slot).
>
> Correct surrogate key lookups against the dimensions, correct grain enforcement, idempotent rebuilds. Handle late-arriving dimension members explicitly.
>
> Explain each fact table's type (transaction, periodic snapshot, aggregate, coverage) and why.

**Verify:** row count reconciliation from silver to gold for every fact. Any discrepancy must have a documented explanation, not a shrug.

**Commit:** `Phase 1 session 11: gold fact table build`

---

## Session 12: Data quality framework, orchestrator and validation

**Brief:**

> Start Phase 1, session 12: DQ framework, orchestrator and end-to-end validation.
>
> - A checks module covering row counts against expected ranges, key uniqueness, referential integrity between facts and dimensions, value range checks, and freshness. Results written to dq.check_results with severity levels.
> - pipeline/run.py as a single orchestrator running bronze to silver to gold with DQ gates between layers, clear logging, and a summary report at the end.
> - A handful of pytest cases on the trickiest transform logic (tenant conforming, SCD Type 2, churn inference).
> - Update README.md as the portfolio-facing front door: what this is, the architecture, how to run it, and what problems it solves.

**Then your Phase 1 exam.** Drop the database, run both commands from scratch, and write SQL yourself answering three business questions from architecture doc section 2.2. No help. If you can do that, Phase 1 is genuinely complete.

**Commit:** `Phase 1 session 12: DQ framework, orchestrator and validation`

---

## Phase 1 definition of done

- [ ] `python generator/generate.py` produces two years of messy bronze files
- [ ] `python pipeline/run.py` builds silver and gold from empty, with DQ logged
- [ ] Both are idempotent and reproducible
- [ ] You can answer three business questions in plain SQL from gold
- [ ] You can explain every file without notes
- [ ] README reads well to a stranger
- [ ] Git history tells the story session by session

Then update the analytics-venture skill file with Phase 1 status, and move to Phase 2 (the frontend template).

---

## Progress tracker

| Session | Topic | Done | Committed |
|---|---|---|---|
| 1 | Config, seeds, schema DDL | yes | yes |
| 2 | Calendar and seasonality | yes | yes |
| 3 | Weather and footfall | yes | yes |
| 4 | POS, bookings, web | yes | yes |
| 5 | Tenants, contracts, lessons | yes | yes |
| 6 | Imperfections, full run | yes | yes |
| 7 | Schema deploy, bronze extract | yes | yes |
| 8 | Silver, structured sources | | |
| 9 | Silver, messy sources | | |
| 10 | Gold dimensions, SCD2 | | |
| 11 | Gold facts | | |
| 12 | DQ, orchestrator, validation | | |

---

## Notes for later

Bring any of these back to the design chat rather than solving them alone in Claude Code:

- A design decision you cannot justify
- A curve or number that does not match Kuwait reality
- Anything that requires a code change where it should be a config change
- Scope creep pressure (dashboards, ML, extra venues) before Phase 1 is done
