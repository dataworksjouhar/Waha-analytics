# Phase 0 Architecture Document
## Analytics Venture, Demo Project: "Al Waha Destination Co."

Version 1.1, 22 July 2026 (equestrian venue added, metrics locked, name confirmed)
Author: Claude (technical co-founder role), for review by Mohammed Jouhar
Status: APPROVED. Phase 1 may begin.

---

## 1. Purpose of this document

This document defines everything needed to start building: the fictional business, the source systems and their file shapes, the warehouse design (medallion layers and star schema), the repository structure, the configuration model that makes this a reusable template, and the synthetic data generator plan. When Jouhar approves this document and selects the dashboard metrics, Phase 1 (pipeline build) begins.

Two goals shape every decision here:

1. **Portfolio and interview credibility.** The design must demonstrate real data warehouse thinking: multiple grains, slowly changing dimensions, genuine data quality problems, and honest handling of source-system mess. It must survive questioning by a technical interviewer.
2. **Template reusability.** The schema core and pipeline must be designed so a future real client (Al Bahar Perfumes, an ads-driven business, a multi-store retailer) becomes a configuration of this system, not a rewrite.

---

## 2. The fictional business

### 2.1 Narrative

**Al Waha Destination Co.** operates **Al Waha Park**, an outdoor lifestyle destination in Kuwait, inspired by real destination operators like Murouj. It opened in 2023. The business has two revenue models under one roof:

**Landlord side:** 10 leased tenants (F&B and retail) pay base rent plus turnover rent (a percentage of their monthly sales above a threshold). Tenants self-report monthly sales figures, which arrive late, in inconsistent formats, and are occasionally restated. This is the single biggest data headache and the demo's data quality showcase.

**Operator side:** 4 own-operated venues where Al Waha runs the tills itself:
- **The Playground** (ticketed entry, family entertainment)
- **The Farm** (petting zoo and activities, ticketed entry plus retail kiosk)
- **Pulse Gym** (monthly memberships plus day passes)
- **Al Waha Equestrian Centre** (riding school with levels and lesson packages, horse boarding/livery for owners, club memberships, and competitions), inspired by Sahara Equestrian Resort

The equestrian centre is deliberately included because it introduces two patterns the other venues do not have: **capacity-constrained scheduled services** (a lesson slot has a fixed number of places and an instructor, so utilization matters more than volume) and **long-cycle recurring revenue** (boarding contracts running for months). Note the structural insight that shapes the model: gym memberships and horse boarding are the same shape, a member-month recurring revenue stream with churn, so they share one fact table rather than two. Recognising that two different-looking businesses are one pattern is exactly the modelling judgement this project is meant to demonstrate.

A booking and e-commerce website sells Playground and Farm tickets, gym memberships, riding lesson packages, and event bookings online. Walk-in sales happen at physical tills. The ERP is Microsoft Dynamics 365 Finance and Operations; our pipeline consumes its exported tables (we generate synthetic files in D365-shaped structures; there is no live connection, and this is described honestly everywhere).

Footfall counters sit at 4 gates and feed hourly counts. Kuwait seasonality is extreme: the outdoor site peaks October through April, drops hard in summer, spikes on the Kuwaiti weekend (Friday and Saturday) and in evenings, shifts pattern during Ramadan, and responds visibly to weather and to events (bazaars, national day, concerts).

### 2.2 The business questions the owner cannot currently answer

These drive the whole design. The GM of Al Waha today lives in the same fog as Jouhar's real-world contacts:

- How many people visited yesterday, and was that good or bad for this time of year?
- Which tenants are underperforming their category, and is anyone under-reporting sales relative to their share of footfall?
- Did last weekend's event actually pay for itself?
- What share of Playground tickets are sold online versus walk-in, and is the website converting?
- How does weather move footfall, and can we plan staffing around it?
- Which tenants are late submitting sales figures, and what turnover rent are we owed?
- Are riding lessons filling up, or are we paying instructors to teach half-empty slots?
- How many stables are occupied, and what is the recurring revenue base across boarding and gym?

### 2.3 Why this maps to real clients later

| Al Waha concept | Al Bahar Perfumes equivalent | Generic SME equivalent |
|---|---|---|
| POS sales (own venues) | Website orders + future store POS | Any sales transactions |
| Booking website sessions | Website traffic | Web analytics |
| Footfall counters | Store footfall (future physical store) | Optional |
| Tenant submissions | Supplier or stock sheets (messy manual data) | Any manual data feed |
| Payments in D365 | UPayment settlements | Any payment platform |
| Weather and events | Seasonality and campaigns | External drivers |

The schema core (sales, locations, visitors, customers, web sessions, external drivers) is shared. Al Bahar later is a smaller config, not a new build.

---

## 3. Source systems and file shapes

All sources are synthetic files produced by our data generator (Section 8). Each lands in the bronze layer exactly as a real client would deliver it: imperfect.

### Source 1: D365 F&O sales export (own-operated venues)

Simulates a Synapse Link style CSV export of invoice line data. Daily file drop.

`d365_salesline_YYYYMMDD.csv`
Columns (D365-flavoured naming, deliberately not clean): `INVOICEID, SALESID, INVOICEDATE, ITEMID, ITEMNAME, QTY, SALESPRICE, LINEAMOUNT, CURRENCYCODE, INVENTSITEID, INVENTLOCATIONID, CUSTACCOUNT, PAYMENTMODE, CREATEDDATETIME`

Realistic imperfections: occasional duplicate invoice lines (re-export overlap), a few negative quantities (refunds, must be handled not dropped), timezone-naive timestamps, currency always KWD but present anyway.

### Source 2: Footfall counters

Hourly counts per gate. One CSV per day per the counter vendor's format.

`footfall_YYYYMMDD.csv`
Columns: `sensor_id, gate_name, date, hour, count_in, count_out`

Realistic imperfections: one sensor has a dead period (48 hours of nulls, requiring an imputation strategy with an `is_imputed` flag), another occasionally double-counts (values roughly 2x neighbours, requiring an outlier rule), gate names inconsistent across files (`Gate 1` vs `GATE_1` vs `G1`).

### Source 3: Tenant monthly sales submissions

The showcase mess. Tenants email a spreadsheet monthly; the leasing coordinator saves them into a folder. One file per tenant per month, but:

`tenant_sales_<tenantname>_<month>.csv`
Columns vary by tenant: some report `gross_sales`, some `net_sales`, some both; date formats vary; one tenant reports weekly rows, others one monthly row; submissions arrive 5 to 40 days after month end; roughly one in ten is later restated with corrected figures (a second file for the same month).

Silver-layer job: conform to one tenant-month grain with `submitted_date`, `submission_version`, `days_late`, and a `restated` flag. This feeds both the turnover-rent calculation and a tenant compliance metric.

### Source 4: Booking website, sessions and transactions

Two GA4-flavoured exports:

`web_sessions_YYYYMMDD.csv`: `date, channel (organic, paid_social, direct, referral), device, sessions, engaged_sessions, users`
`web_bookings_YYYYMMDD.csv`: `booking_id, booking_datetime, product_code (playground_ticket, farm_ticket, gym_daypass, gym_membership, event_ticket), qty, amount_kwd, channel, customer_id`

Realistic imperfections: bookings exist with channels missing (direct attribution loss), a small percentage of cancelled bookings arrive as negative-amount rows.

### Source 5: Events calendar

A manually maintained sheet: `event_id, event_name, event_type (bazaar, concert, national_holiday, kids), start_date, end_date, expected_attendance`. Imperfection: overlapping events, one event with end before start (DQ catch).

### Source 6: Weather

Daily: `date, temp_max_c, temp_min_c, dust_storm_flag, rain_mm`. Clean by design (external API data usually is); used as a driver dimension.

### Source 7: Membership and boarding contracts (recurring revenue)

Exported monthly from the membership system (D365-adjacent, separate file). Covers gym memberships, equestrian club memberships, and horse boarding contracts in one structure, because they are the same pattern.

`contracts_YYYYMM.csv`
Columns: `contract_id, member_id, contract_type (gym_monthly, gym_annual, equestrian_club, horse_boarding), venue_id, start_date, end_date, monthly_amount_kwd, status (active, expired, cancelled), cancellation_date, stable_id`

Realistic imperfections: `end_date` null for open-ended contracts (churn must be inferred from status and last payment, a genuinely common analytics problem), a few contracts with cancellation dates before start dates (DQ catch), member records duplicated where someone holds both a gym and an equestrian membership under different member IDs (an identity resolution talking point, resolved on phone number in silver).

### Source 8: Lesson schedule and attendance (capacity data)

`lessons_YYYYMMDD.csv`
Columns: `lesson_id, lesson_date, start_time, instructor_id, level (beginner, intermediate, advanced), capacity, booked, attended, horse_ids`

Realistic imperfections: `attended` sometimes missing (coach forgot to mark), occasional bookings above capacity (overbooking to be flagged, not silently dropped).

Lesson *revenue* flows through bookings and POS as package purchases; this file supplies the capacity denominator for utilization. That split (revenue in one system, capacity in another) is exactly the real-world join that makes utilization metrics hard, so it stays.

### Source 9: Master data (dimensional sources)

`tenants.csv`: tenant details, category, unit, lease start, base rent, turnover rent percentage and threshold. Includes one tenant that closes mid-history and one that changes category, forcing SCD Type 2 handling.
`venues.csv`, `products.csv`, `gates.csv`: static reference data.
`stables.csv`: stable/box inventory for the equestrian centre (total capacity denominator for occupancy).
`instructors.csv`, `horses.csv`: riding school reference data.

---

## 4. Medallion architecture

**Bronze:** raw files exactly as landed, immutable, organised by source and load date (`data/bronze/<source>/<load_date>/`). Nothing edited here, ever. Stored as files (CSV as received, optionally mirrored to parquet).

**Silver:** cleaned, typed, deduplicated, conformed entities loaded to Postgres schema `silver`. One table per conformed entity (e.g. `silver.pos_sales_lines`, `silver.footfall_hourly`, `silver.tenant_sales_monthly`). Every table carries lineage columns: `_source_file`, `_loaded_at`, `_dq_flags`.

**Gold:** the star schema in Postgres schema `gold` (Section 5), plus a small number of pre-aggregated reporting views for the dashboard.

**Data quality framework:** a lightweight checks module (row counts vs expected, key uniqueness, referential integrity, value ranges, freshness). Failures write to a `dq.check_results` table and surface on an internal health page later. This is deliberately hand-built rather than a heavy framework: the point is demonstrating the thinking.

---

## 5. Gold layer: star schema

The deliberate feature of this design is **grain diversity**, because that is what interviewers probe and what real businesses have.

### Fact tables

| Table | Grain | Approx rows (2 yrs) | Notes |
|---|---|---|---|
| `fact_pos_sales` | Invoice line | ~400k | Own venues. Refunds as negative rows, `is_refund` flag |
| `fact_footfall` | Gate x hour | ~70k | `is_imputed`, `is_outlier_corrected` flags |
| `fact_tenant_sales` | Tenant x month x version | ~600 | Versioned; current-version view on top |
| `fact_bookings` | Booking | ~120k | Online transactions, cancellations flagged |
| `fact_web_sessions` | Date x channel x device | ~9k | Aggregate grain by design |
| `fact_membership_months` | Contract x month | ~25k | **Periodic snapshot fact.** Gym plus equestrian club plus boarding in one table. Carries `is_new`, `is_churned`, `mrr_kwd` |
| `fact_lesson_slots` | Lesson slot | ~15k | Capacity, booked, attended. Enables utilization and no-show rate |

Note the deliberate variety of fact table *types*, not just grains: transaction facts (`fact_pos_sales`, `fact_bookings`), periodic snapshot (`fact_membership_months`), aggregate (`fact_web_sessions`), and a capacity/coverage fact (`fact_lesson_slots`). Being able to name and justify these types is standard senior-level warehouse interview territory.

### Dimension tables

| Table | Type | Notes |
|---|---|---|
| `dim_date` | Static | Includes Kuwait weekend flags (Fri/Sat), Ramadan flag, public holidays, season |
| `dim_tenant` | **SCD Type 2** | Category change and closure in history; `valid_from`, `valid_to`, `is_current` |
| `dim_venue` | Type 1 | Own venues and zones |
| `dim_gate` | Type 1 | Conformed gate names |
| `dim_product` | Type 1 | Tickets, passes, memberships, kiosk items |
| `dim_customer` | Type 1 | Online customers only (walk-ins anonymous, and that is a truthful modelling point) |
| `dim_event` | Type 1 | With date-range bridge to `dim_date` |
| `dim_channel` | Type 1 | Web channels |
| `dim_member` | Type 1 | Gym, equestrian club and boarding members; identity-resolved on phone across systems |
| `dim_stable` | Type 1 | Stable/box inventory for occupancy calculations |
| `dim_instructor` | Type 1 | Riding school instructors |

Weather joins via `dim_date` (one row per day, so weather attributes live on a `dim_date` extension table `dim_date_weather` to keep `dim_date` static and reusable across clients).

### Conformed dimensions and the template argument

`dim_date`, `dim_customer`, `dim_product`, and a generic `dim_location` concept (venue, gate, store) are the shared core. When Al Bahar arrives: `fact_pos_sales` becomes their order lines, `fact_web_sessions` their traffic, `fact_bookings` their orders, footfall waits for their physical store. Same code paths, different config.

---

## 6. Repository structure

```
waha-analytics/                     (working name, rename freely)
├── README.md                       (portfolio-facing: what, why, architecture diagram)
├── config/
│   ├── client_waha.yml             (THE config: sources, mappings, metrics, branding)
│   └── schema/                     (table definitions as SQL or YAML)
├── data/
│   ├── bronze/                     (generated raw files land here; gitignored)
│   └── seeds/                      (master data CSVs)
├── generator/
│   ├── generate.py                 (entry point: builds 2 years of synthetic data)
│   ├── calendars.py                (seasonality, Ramadan, weekends, events)
│   ├── footfall.py, pos.py, tenants.py, web.py, weather.py
│   ├── contracts.py                (gym, equestrian club, boarding recurring revenue)
│   ├── lessons.py                  (riding school schedule, capacity, attendance)
│   └── mess.py                     (injects the deliberate imperfections)
├── pipeline/
│   ├── run.py                      (orchestrator: bronze -> silver -> gold + DQ)
│   ├── extract/                    (file landing and registration)
│   ├── transform/                  (silver conform logic per source)
│   ├── load/                       (gold builds: dims first, then facts)
│   └── dq/                         (checks module, results writer)
├── sql/                            (gold views, reporting aggregates)
├── app/                            (Phase 2: React dashboard template)
├── tests/                          (a handful of pytest cases on transforms)
└── .github/workflows/              (Phase 3: scheduled refresh)
```

### The config model (the "one template, many configs" mechanism)

`client_waha.yml` sketch:

```yaml
client:
  name: Al Waha Destination Co.
  currency: KWD
  weekend: [FRI, SAT]
  branding: { primary: "#0F4C81", logo: waha.svg }
sources:
  pos_sales:   { type: csv_drop, pattern: "d365_salesline_*.csv", mapping: d365_fno }
  footfall:    { type: csv_drop, pattern: "footfall_*.csv", mapping: vendor_a }
  tenant_sales:{ type: csv_folder, mapping: tenant_freeform }
  web:         { type: csv_drop, mapping: ga4_export }
metrics:
  enabled: [footfall_vs_ly, tenant_performance, ...]   # Jouhar's Phase 0 selection
```

A future client changes this file, the `mapping` implementations for their sources, and nothing else. New mappings get added to the shared library, never forked.

---

## 7. Technology decisions (locked for Phase 1)

| Concern | Choice | Rationale |
|---|---|---|
| Language | Python 3.12, pandas | Learnable, interviewable, sufficient at this scale |
| Warehouse | Postgres (Supabase or Neon free tier) | Real SQL warehouse semantics, zero cost, per-client isolation |
| Bronze storage | Local/repo files now, object storage later | Simplicity first |
| Orchestration | `pipeline/run.py` now, GitHub Actions cron in Phase 3 | No Airflow; a one-person shop does not carry Airflow |
| Dashboard | Phase 2 decision (React template; Streamlit fallback) | Out of Phase 1 scope |
| DQ | Hand-built checks module | Demonstrates thinking; no Great Expectations dependency |

Explicitly rejected for now: live D365 connection, Spark, dbt (worth learning later, but hand-writing the transforms first is the better learning path and interview story), Airflow, any ML.

---

## 8. Synthetic data generator plan

The generator is itself portfolio-worthy and must produce data that behaves like Kuwait:

- **2 years of history** (July 2024 to July 2026) so year-over-year comparisons work.
- **Seasonality engine:** winter peak (Oct-Apr), summer trough (Jun-Aug outdoor collapse), Friday/Saturday weekend spikes, evening-weighted hourly curves, Ramadan pattern shift (late-night activity, changed F&B behaviour), holiday and event spikes.
- **Causal links, not independent tables:** footfall drives POS sales and tenant sales with noise; weather (heat, dust storms) suppresses footfall; events lift it; web sessions lead bookings with a realistic conversion rate; one tenant under-reports sales relative to their footfall share (a findable insight planted for the demo story).
- **Deterministic seed** so the demo is reproducible.
- **`mess.py` injects every imperfection listed in Section 3**, each behind a toggle, so we can generate clean data for testing transforms and messy data for the real demo.

Planted insights the dashboard should be able to reveal (the demo's "wow" moments): the under-reporting tenant, the sensor outage handled transparently, an event that lost money, a paid-social channel with collapsing conversion, summer staffing misalignment vs footfall, and, on the equestrian side, beginner lesson slots running near capacity while advanced slots sit half empty (an obvious scheduling and pricing fix that pays for the whole engagement).

Equestrian seasonality note: riding activity follows the same winter-peak curve as the park, but boarding revenue does not, since horses stay stabled year round. That divergence between transactional and recurring revenue is realistic and makes metric 9 (revenue mix) genuinely interesting rather than flat.

---

## 9. Locked decisions (approved by Jouhar, 22 July 2026)

**Name:** Al Waha Destination Co. / Al Waha Park. Fictional throughout. Murouj and Sahara Equestrian Resort are named openly as *inspiration* in the README and pitch, never as the brand on the product. Rebranding to a real client is a config change, and demonstrating that live in a meeting is the pitch.

**Final metric set (12), which the gold layer must support:**

| # | Metric | Primary facts |
|---|---|---|
| 1 | Daily footfall vs last week and last year, weather overlay | `fact_footfall`, `dim_date_weather` |
| 2 | Footfall-to-sales conversion for own venues | `fact_footfall`, `fact_pos_sales` |
| 3 | Turnover rent owed vs collected | `fact_tenant_sales`, `dim_tenant` |
| 4 | Sales per square metre by tenant category | `fact_tenant_sales`, `dim_tenant` |
| 5 | Online vs walk-in ticket mix | `fact_bookings`, `fact_pos_sales` |
| 6 | Website conversion rate by channel | `fact_web_sessions`, `fact_bookings` |
| 7 | Event ROI (uplift vs baseline footfall and sales) | `fact_footfall`, `fact_pos_sales`, `dim_event` |
| 8 | Membership active base and churn (gym plus equestrian club) | `fact_membership_months` |
| 9 | Revenue summary: own venues vs rental income | `fact_pos_sales`, `fact_tenant_sales`, `fact_membership_months` |
| 10 | Average transaction value by venue | `fact_pos_sales` |
| 11 | **Riding lesson slot utilization** (booked vs capacity, plus no-show rate, by level and instructor) | `fact_lesson_slots` |
| 12 | **Stable occupancy and boarding revenue** (occupied boxes vs total, recurring revenue base) | `fact_membership_months`, `dim_stable` |

Metrics 11 and 12 are the equestrian additions. Tenant submission compliance is not a headline metric but is retained as a supporting view, since it underpins metric 3.

**Remaining Jouhar task:** confirm the 2-week Phase 1 window against real calendar availability. Job search stays priority one; if a live interview process heats up, Phase 1 pauses rather than competes.

## 10. Phase 1 preview (so the finish line is visible)

Definition of done for Phase 1: `python generator/generate.py` produces two years of messy bronze files; `python pipeline/run.py` builds silver and gold in Postgres with DQ results recorded; a short SQL session can answer three of the business questions in Section 2.2 directly from gold tables. Everything explainable by Jouhar in an interview without notes.
