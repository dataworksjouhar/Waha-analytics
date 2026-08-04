# Al Waha Analytics Platform
## Complete project reference

Prepared for Mohammed Jouhar, August 2026
Status: internal reference document, not for publication

---

## How to use this document

Part 1 is the story: why this project exists and what decisions shaped it. Part 2 explains the business being modelled. Parts 3 to 6 are the technical build, written to teach rather than to summarise. Part 7 covers the dashboard. Part 8 gives you the answers to the questions an interviewer or a client will ask. Part 9 is what to do next. Part 10 is a plain-language glossary of every term used.

If you read only two parts before an interview, read Part 8 and Part 10.

---

# PART 1: WHERE THIS CAME FROM

## 1.1 The trigger

A friend running Al Bahar Perfumes, an online oud and perfume business in Kuwait, asked for help. His situation was ordinary and instructive:

- He paid a developer to build his website but had no idea what was behind it, where data lived, or how it worked.
- He read his sales off UPayment, the payment platform, on screen. No export, no history, no analysis.
- Orders reached him through WhatsApp and Gmail notifications.
- Stock was managed manually by one person. Nobody could say how it connected to the site.
- An accountant handled books separately. Armada handled delivery.
- When something went wrong, every vendor blamed another and he had no way to judge.

The clinching detail: a customer paid, the money was deducted and received, and the website errored so the order was never recorded. Two months later it was still unresolved. That is not a display bug, it is a payment callback failure, and if it happened once unnoticed there was no reason to think it happened only once.

The insight worth keeping: **his problem was not a missing dashboard. It was that no single order could be traced from website to payment to stock to delivery.** A dashboard built on that foundation would have produced confident numbers that were quietly wrong.

## 1.2 The pattern

Al Bahar was not unique. Within days the same shape appeared in a friend running a business primarily through ads with no attribution, a contact operating around ten retail stores across countries, and the general run of Kuwaiti SMEs: websites everywhere, analytics nowhere.

## 1.3 The idea, and the argument against building it first

The initial plan was a multi-tenant analytics SaaS: React frontend, login, connectors to any source, medallion pipeline, machine learning later, sold to SMEs.

The argument against building that first, which shaped everything since:

- It is a twelve to eighteen month build for a funded engineering team.
- While building it you earn nothing and learn nothing about customers.
- The thing being described already exists. It is called Power BI Service.
- The real failure mode is not building software. It is *owning* software. Five clients on five bespoke codebases kills a one-person business through maintenance, not development.

## 1.4 What was decided instead

**Sell the outcome, extract the product from repetition.** Deliver real reporting to real clients using tools that already work, notice what repeats, harden the repeated parts into a reusable toolkit, and only build a platform if paying clients fund it.

Locked decisions:

| Decision | Reasoning |
|---|---|
| The product is the pipeline, not the dashboard | Anyone can draw charts. Getting trustworthy data out of UPayment, guarded databases and stock sheets is the hard, valuable part |
| Two-tier frontend | Power BI for clients who will pay Microsoft licensing, custom React for those who will not. Same pipeline underneath both |
| One template, many configs | Every client is a configuration file, never a code fork. This is the survival rule |
| Real money from client one | Including friends, including discounted |
| Demo first, on a realistic fake business | Something to show before asking anyone to buy |
| Job search stays priority one | The build doubles as interview preparation, so the time counts twice |

## 1.5 Why the demo is a destination operator

The demo could have been the perfume shop. It became a multi-venue lifestyle destination because of an interview with AJRE (Al Jazeera Real Estate Development Co.), operators of Murouj, Murouj Farm, Sahara Golf and Sahara Equestrian Resort. The interview went well, they were impressed, and they concluded the role might not be challenging enough. They never came back.

During that interview the general manager pointed at a site map on his wall and asked whether a reporting dashboard could cover all of it. That question shaped the entire dashboard design.

A destination operator is a better demo subject than a shop because it is a genuinely harder data problem:

- **Two business models under one roof.** Landlord (leased tenants paying turnover rent) and operator (own venues taking money directly).
- **Footfall is the core currency**, which is exactly Jouhar's Alshaya specialism, seen from the other side of the table.
- **Tenants self-report sales**, late and inconsistently, which is a real and messy data problem.
- **Extreme seasonality**, so any model that ignores season is wrong.
- **Multiple grains and capacity constraints**, which forces proper warehouse design.

The demo is fictional and named Al Waha Park. It is never branded as Murouj. Publishing invented sales figures, an invented under-reporting tenant and uncollected rent under a real operator's trademark is a legal and reputational risk, and screenshots travel without disclaimers. The stronger pitch is to walk in with a neutral demo and rebrand it live: the site plan, the sources and the metric list are configuration.

---

# PART 2: THE BUSINESS BEING MODELLED

## 2.1 Al Waha Destination Co.

An outdoor lifestyle destination in Kuwait, open since 2023.

**Landlord side.** Ten leased tenants (food, beverage, retail, services) paying base rent plus turnover rent, which is a percentage of monthly sales above a threshold. Tenants email their sales figures monthly.

**Operator side.** Four venues where Al Waha runs the tills:
1. The Playground, ticketed family entertainment
2. The Farm, petting zoo and activities, tickets plus a retail kiosk
3. Pulse Gym, monthly memberships and day passes
4. Al Waha Equestrian Centre, riding school, horse boarding, club memberships, competitions

Plus a booking website selling tickets, memberships and lesson packages, four footfall gates, and Microsoft Dynamics 365 as the ERP.

## 2.2 Why the equestrian centre matters to the design

It was added because AJRE named Sahara Equestrian Resort as a main business line, and it earns its place by introducing two patterns nothing else has:

- **Capacity-constrained scheduled services.** A lesson slot has fixed places and an instructor, so utilization matters more than volume. An empty advanced slot costs the same as a full one.
- **Long-cycle recurring revenue.** Boarding contracts run for months.

And one modelling insight worth stating in any interview: **gym memberships and horse boarding are structurally the same thing**, a member-month recurring revenue stream with churn. They share one fact table rather than two. Recognising that two different-looking businesses are one pattern is the judgement that separates a data modeller from a report writer.

## 2.3 Seasonality, the defining rule

Peak season is mid-October to end of March. Every line of business does well then. But the curves differ, and using one shared seasonality factor would have been wrong:

| Business line | Behaviour |
|---|---|
| Outdoor park, tenants, footfall | Strong winter peak, sharp decline April to May, deep trough June to August, recovery late September |
| Equestrian lessons | Year round because the arena is air conditioned. Moderate July and August dip caused by families travelling abroad, not by weather |
| Horse boarding | Effectively flat. Horses stay stabled regardless of season |
| Gym | Mild seasonality, small January intake spike |

Other calendar effects: Ramadan shifts activity to late evening rather than reducing it; National and Liberation Day (25 and 26 February) fall inside peak season and spike hard; school holidays lift daytime family traffic; the Kuwaiti weekend is Friday and Saturday.

**Why this matters technically:** because boarding revenue is flat while park revenue collapses, the revenue mix chart is genuinely interesting rather than a flat bar. It also became the root cause of the biggest bug in the project (Part 6).

## 2.4 The questions the GM cannot currently answer

Everything in this project exists to answer these:

1. How many people came yesterday, and was that good for this time of year?
2. Which tenants underperform their category, and is anyone under-reporting relative to their footfall share?
3. Did last weekend's event pay for itself?
4. What share of tickets sell online, and is the website converting?
5. How does weather move footfall, and can staffing follow it?
6. Which tenants file late, and what turnover rent are we owed?
7. Are riding lessons filling, or are we paying instructors to teach half-empty slots?
8. How many stables are occupied, and what is the recurring revenue base?

---

# PART 3: THE ARCHITECTURE

## 3.1 Medallion architecture, and why

Data moves through three named layers. The analogy that makes it stick is a restaurant kitchen.

**Bronze is the delivery door.** Crates arrive exactly as the supplier packed them, bruised produce included, one crate delivered twice, one box mislabelled. You stack it and change nothing. If you ever need to prove what actually arrived, this is the evidence.

**Silver is the prep station.** Wash, trim, sort. The bruised items get labelled rather than binned. The double delivery is reconciled. The mislabelled box is renamed correctly. Crucially, nothing is thrown away silently.

**Gold is the finished dish, plated.** The star schema a dashboard actually reads from.

The one-sentence version: **bronze is what they sent you, silver is what you can trust, gold is what they can use.**

Why this matters commercially: when a client disputes a number, you can walk backwards from the chart to the exact source file and show every transformation applied. That is the difference between an analyst and a vendor.

## 3.2 Why bronze stores everything as text

A real source file might contain `31/02/2025` in a date column, or `N/A` in a number column. If bronze enforced a date type, the load would fail and you would lose the evidence that they sent you garbage. Typing happens in silver, where a bad value can be flagged instead of choking the pipeline.

This is a good interview answer, because most people assume typing early is always better.

## 3.3 The technology, and why each choice

| Concern | Choice | Reasoning |
|---|---|---|
| Language | Python 3.14, pandas | Learnable, interviewable, sufficient at this scale |
| Warehouse | Postgres on Supabase, Mumbai region | Real SQL warehouse semantics, free tier, per-client isolation, and Supabase also provides authentication for a later phase |
| Bronze storage | Files on disk plus a registry table | Immutability is easier with files |
| Orchestration | A single `run.py` | A one-person shop cannot carry Airflow |
| Data quality | Hand-built checks module | Demonstrates the thinking rather than hiding it behind a framework |
| Transforms | Hand-written, no dbt | Deliberate. Writing them by hand first is the better learning path and the stronger story |

Explicitly rejected for now: live Dynamics 365 connection, Spark, dbt, Airflow, any machine learning. Each of these is a good tool. None of them was needed, and adding them would have been decoration.

## 3.4 The star schema

A star schema means fact tables (the events, the measurements) surrounded by dimension tables (the descriptive context). It is called a star because a diagram of it looks like one.

**Seven fact tables, deliberately spanning four different types.** Being able to name the type and justify it is standard senior-level interview territory.

| Fact table | Grain (what one row means) | Type |
|---|---|---|
| `fact_pos_sales` | One invoice line | Transaction |
| `fact_bookings` | One booking | Transaction |
| `fact_footfall` | One gate, one hour | Transaction (measurement) |
| `fact_tenant_sales` | One tenant, one month, one submitted version | Transaction with versioning |
| `fact_membership_months` | One contract, one month | **Periodic snapshot** |
| `fact_web_sessions` | One date, channel and device | **Aggregate** |
| `fact_lesson_slots` | One lesson slot | **Coverage / capacity** |

**Grain** is the single most important concept here. It is the answer to "what does one row of this table represent?" Get it wrong and every number built on it is wrong. Mixed grain in one table is the most common serious modelling error.

Why a periodic snapshot for memberships: a transaction fact would record joins and cancellations as events, which cannot answer "how many active members did we have in March?" without complex reconstruction. A snapshot records one row per contract per month, so the question becomes a simple count.

Why a coverage fact for lesson slots: it records capacity that existed, whether or not it was used. Without it you can count bookings but never compute utilization, because you have no denominator.

**Eleven dimensions**, including `dim_date` (with Kuwaiti weekend, Ramadan and holiday flags), `dim_tenant`, `dim_venue`, `dim_gate`, `dim_product`, `dim_customer`, `dim_member`, `dim_stable`, `dim_instructor`, `dim_event` and `dim_channel`.

## 3.5 Slowly Changing Dimension Type 2

The most probed concept in senior data interviews, so it was built in deliberately.

The problem: a tenant changes category from Coffee to Dessert in June. If you simply overwrite the category, then every historical report is retrospectively rewritten, and January's sales now appear under Dessert even though the shop was a coffee shop at the time.

SCD Type 2 solves it by keeping both versions as separate rows with validity dates:

| tenant_key | tenant_id | name | category | valid_from | valid_to | is_current |
|---|---|---|---|---|---|---|
| 41 | T3 | Bayt Al Halwa | Coffee | 2024-07-01 | 2025-05-31 | false |
| 88 | T3 | Bayt Al Halwa | Dessert | 2025-06-01 | 9999-12-31 | true |

Facts join on `tenant_key`, the surrogate key, so each transaction stays attached to the version of the tenant that was true when it happened. History is preserved. The demo includes one tenant that changes category and one that closes mid-history, so the mechanism is demonstrable rather than theoretical.

**Surrogate keys** are the artificial integers (41, 88) rather than the business identifier (T3). They exist precisely so one business entity can have several versions.

## 3.6 The config model

Everything client-specific lives in `config/client_waha.yml`: currency, weekend days, branding, source definitions and mappings, seasonality curves, metric list. A different client changes that file plus any new source mappings. The code does not change.

This is the mechanism behind the "one template, many configs" rule, and it is the single most important thing to demonstrate to a prospective client. Not a claim, a file you can open.

---

# PART 4: THE DATA GENERATOR

## 4.1 Why build a generator at all

Because there is no real client data yet, and because a portfolio project built on clean textbook data proves nothing. The generator is itself a portfolio artifact: it encodes real knowledge of how a Kuwaiti destination behaves.

## 4.2 The causal chain

The critical design decision: the tables are **not generated independently**. They cause each other, the way a real business does.

```
Calendar and seasonality
        |
        v
Weather  ---->  Footfall  ---->  POS sales
                   |                 |
                   |                 v
                   +---------->  Tenant sales
Web sessions ----> Bookings ----> Lesson attendance
Contracts (recurring, largely independent of season)
```

If footfall and sales were generated independently, then footfall-to-sales conversion would be noise, the under-reporting tenant would be undetectable, and every insight in the dashboard would be fake. The causal chain is what makes the findings real findings.

## 4.3 The seasonality engine

Built first, because everything keys off it. It produces, per day: the season index for each venue type, weekend and weekday flags, Ramadan status, holidays, school terms, and an hourly weight curve that is evening-weighted normally and shifts shape during Ramadan.

All curve values live in config, not code. This was tested explicitly: changing a curve must be a YAML edit. If it required touching Python, the config model would have been wrong.

## 4.4 Deliberate imperfections

A separate module injects flaws, each behind a toggle so clean data can be generated for testing transforms and messy data for the real demo:

| Source | Injected problem | What it forces you to solve |
|---|---|---|
| Footfall | One sensor dead 48 hours | Imputation strategy plus a flag |
| Footfall | One sensor double counting for two weeks | Outlier detection that respects seasonality |
| Footfall | Gate names as `Gate 1`, `GATE_1`, `G1` | Conforming to a standard |
| POS | Duplicate lines from re-export overlap | Deduplication on a business key |
| POS | Negative quantities for refunds | Keeping them, not dropping them |
| Tenant sales | Varying columns, date formats, weekly versus monthly rows, 5 to 40 days late, some restated | Conforming to one grain with versioning |
| Contracts | Null end dates, cancellations before starts, duplicate member identities | Churn inference and identity resolution |
| Lessons | Missing attendance, overbooked slots | Flagging rather than discarding |
| Events | One event ending before it starts | A basic integrity check |

## 4.5 Planted insights

Findings were deliberately buried in the data so the dashboard has something to discover:

1. **A tenant under-reporting sales** relative to its footfall share and category peers.
2. **Beginner lesson slots near capacity while advanced sit half empty**, an obvious scheduling and pricing fix.
3. **An off-season event that lost money**, where the same budget in October would have returned far more.
4. **A paid social channel whose conversion halved** while sessions held steady.
5. **Summer staffing misaligned with footfall.**

These matter because they are the difference between a dashboard and a consultant. Anyone can show KPI cards. A demo that hands a GM a finding starts a commercial conversation.

---

# PART 5: THE PIPELINE

## 5.1 Bronze: extract and register

Scans the generated files, records every one in a **file registry** table (filename, source type, load timestamp, row count, checksum), and loads contents into bronze tables with no transformation.

The file registry is quietly one of the most commercially useful objects in the whole system. In a real engagement it answers "did you receive our March file?" with a record instead of an argument.

The load is **idempotent**: running it twice does not duplicate rows. This matters because pipelines fail halfway and get re-run, and a pipeline that corrupts itself on retry is worse than no pipeline.

## 5.2 Silver: the decisions, and their business justification

Each rule here is a decision you should be able to defend.

**Refunds stay as negative rows.** Netting them away hides the refund rate, which is a leading indicator of product or service problems. A refund is a real event and deserves a row.

**Duplicates are flagged, not deleted.** The row stays with `is_duplicate = true` and is excluded by the gold layer. If the deduplication logic is ever wrong, the evidence still exists.

**The dead sensor is imputed and labelled.** Leaving a hole makes every total quietly understated. Filling it invisibly makes an estimate look like a measurement. So the gap is estimated and every affected row carries `is_imputed = true`.

**Gate names are conformed** to one standard so a group-by returns four gates instead of nine.

**Tenant submissions are versioned, never overwritten.** A restated filing arrives as a new version with its own submission date. A current-version view sits on top. This is what lets a rent dispute be settled with a record.

**Churn is inferred** where contract end dates are null, because open-ended contracts do not announce their ending. Status and last payment date carry the logic.

**Member identities are resolved on phone number** across the gym and equestrian systems, because the same person holds two contracts under two IDs.

Every silver table carries lineage columns: `_source_file`, `_loaded_at`, `_dq_flags`.

## 5.3 Gold: dimensions then facts

Dimensions build first because facts need their surrogate keys. Facts then look up those keys, enforce their grain, and rebuild idempotently.

## 5.4 Data quality framework

A checks module covering row counts against expected ranges, key uniqueness, referential integrity between facts and dimensions, value ranges, and freshness. Results are written to `dq.check_results` with severity levels rather than printed and lost.

The distinction worth internalising: **quality checks that record results are an asset; quality checks that only print to a console are a habit.**

---

# PART 6: THE THREE PROBLEMS WORTH TELLING PEOPLE ABOUT

These are the best stories in the project. Each one is a real bug found through verification, not a hypothetical.

## 6.1 The outlier rule that deleted the busiest nights of the year

**What was built.** Footfall outlier detection flagging any reading more than 1.5 times a rolling median.

**What verification found.** Only 55% of the genuinely doubled rows were caught. Meanwhile all four gates, including three that were never faulty, had between 1,582 and 1,725 rows flagged as corrected, concentrated almost entirely on Fridays and Saturdays. A concrete example: a normal winter Friday, 14 November 2025, main gate, hour 19, raw 412 reduced to 266.

**The root cause.** Weekend footfall legitimately runs about 1.6 times weekday footfall. The rule compared a Friday evening against a rolling median blending Tuesdays and Fridays, so it could not distinguish a broken sensor from a busy night. It was quietly shaving down real peak-season trading.

**The fix.** Compare like with like: same gate, same hour, same day type. A doubled Friday is still double what other Fridays look like, so the real anomaly stands out and legitimate peaks survive.

**Why this story is worth telling.** It is the perfect illustration of statistical technique applied without domain knowledge destroying the signal it was meant to protect. And note where the domain knowledge came from: not from any model, but from knowing that a Kuwaiti outdoor destination trades 1.6 times harder on a Friday.

## 6.2 The pipeline that could not run twice

**What happened.** The first full run took 631 seconds and scraped through. The second run hit `QueryCanceled: statement timeout` on all five retry attempts and crashed.

**The root cause.** A single unchunked `SELECT *` reading 312,000 rows, against a pooler with a two-minute statement timeout.

**The fix.** Chunked reads, and a COPY-based write path instead of row-by-row inserts.

**Why it mattered.** The Phase 1 definition of done requires running clean from an empty database. A pipeline that works once is a script. A pipeline that works every time is infrastructure.

## 6.3 The five refunds that broke the join

**What happened.** Five refunds were dated 2 to 4 July 2026, just past the calendar's end on 1 July. The fact table needs `date_key` pointing at a real row in `dim_date`, and those dates did not exist. The load failed.

**The options offered.** Drop the five rows, or regenerate everything.

**The decision taken.** Neither. Extend `dim_date` past the data window. Date dimensions are conventionally built with a buffer precisely because facts drift past the nominal end: late refunds, backdated invoices, delivery dates, contract expiries.

**The principle.** When a fact does not fit the model, first ask whether the model is too narrow, before considering removing the fact. In a real business this exact case is a customer paying on 30 December and refunding on 3 January. Dropping those rows would understate refunds and overstate December revenue.

---

# PART 7: THE DASHBOARD

## 7.1 The design premise

Built in four versions, each one responding to specific criticism. The premise came from the AJRE interview: the GM pointed at a site map and asked whether reporting could cover all of it. He did not ask for charts, he asked about *his business as he pictures it*.

## 7.2 The signature elements

**The season ribbon.** Twenty-four months across the top as bars, coloured for peak and off season, acting as both the time filter and the argument. Click a month or drag a range. It replaces a conventional date picker with something that states the thesis: at this business, the season decides everything.

**The site plan.** A stylised plan of the park where tenant plot heights are proportional to leased area, so a large weak unit is visible before you read a number. Colour switches between footfall share, sales per square metre, turnover rent and reporting compliance. An hour slider makes the gates swell and shrink with live hourly volume, which turns the evening-weighted curve into something physical.

The commercial argument for the map is not theatre: leasing is a spatial business, sales per square metre is inherently spatial, and "which units get walked past but not walked into" is a placement question invisible in a table.

**The insights panel.** Findings in plain language with numbers attached, filtered to whatever is selected.

**The trust modal.** Bronze to silver to gold, the real pipeline figures, and four claims about why the numbers can be relied on. This turns weeks of invisible pipeline work into the main exhibit.

## 7.3 Version history, which is itself the story

| Version | What it added | Prompted by |
|---|---|---|
| v1 | Three views, season ribbon, insights panel | Initial layout |
| v2 | Site plan with metric switching, hour scrubber, unit drill-down | The GM's map question |
| v3 | Range selection, compare to plan, targets and capacity, event ROI, clickable table with sparklines, growth funnel, architecture modal | Six specific criticisms |
| v4 | Cross-filtering, designed mobile layout, shareable state links, CSV export, freshness strip, reworded trust modal | Push to production quality |

## 7.4 The deployment decision

The portfolio dashboard reads pre-aggregated static JSON rather than querying the database live. Reasoning: free-tier databases pause after inactivity, so the one time a recruiter visits after a quiet week the dashboard would error; a Mumbai round trip on every filter click is slow; and a public frontend holding database credentials is a security conversation you do not want. The data is fixed and synthetic, so there is nothing to refresh.

For a real client, the same frontend points at a live warehouse. That is a configuration value.

---

# PART 8: HOW TO EXPLAIN THIS

## 8.1 In sixty seconds

"I built an analytics platform for a fictional Kuwaiti destination operator: ten leased tenants, four own-operated venues including an equestrian centre, and a booking website. I generated two years of deliberately messy source data, then built a Python pipeline that lands it raw, cleans and flags it, and models it into a star schema in Postgres. On top sits an interactive dashboard. The point of the project is not the charts, it is that every number can be traced back to the file it came from, and the data quality problems are handled visibly rather than hidden."

## 8.2 In five minutes

Add: the medallion layers and why bronze stays untouched; the seven fact tables across four types and why grain matters; SCD Type 2 on tenants; the deliberate imperfections and what each one forces you to solve; and one of the three bug stories, preferably the outlier rule.

## 8.3 Likely questions and strong answers

**"Why not just use Fabric or dbt?"**
Because building it by hand once teaches the concepts that transfer to both. Medallion layers, incremental loads, quality gates and orchestration are ideas, not features of any product. Having implemented them manually, Fabric becomes the managed version of something I have already built. I would use dbt on a team where transformation logic needs to be shared and tested by several people.

**"This is synthetic data. Does it prove anything?"**
It proves more than clean sample data would. I designed the imperfections deliberately, which required knowing what actually goes wrong: sensors fail, tenants file late in their own formats, re-exports duplicate, refunds arrive after period end. Then I had to solve each one. And the causal structure is real, footfall drives sales, weather drives footfall, so the findings in the dashboard are genuine findings rather than decoration.

**"What is the grain of your footfall table?"**
One gate, one hour. Which is why gate name conforming mattered: three naming conventions across vendor files would otherwise have produced nine gates in a group-by instead of four.

**"How did you handle the sensor outage?"**
Imputed and flagged. Every affected row carries `is_imputed`. Leaving the gap understates totals; filling it silently disguises an estimate as a measurement. The flag is what lets a reader tell the difference.

**"Tell me about a bug you found."**
The outlier rule story from Part 6.1. It is the strongest answer in the set because it shows verification, root cause analysis, and domain knowledge overriding a statistical default.

**"How would you onboard a new client?"**
Change the configuration file: sources and their mappings, the site plan, the seasonality curves, the metric list, branding. Add a source mapping to the shared library if their format is new. The pipeline code does not change. That constraint is deliberate, because a one-person shop dies from maintaining forks.

**"What would you do differently?"**
Written the verification queries before the transforms rather than after. Both bugs I found were found by verification, which means anything I did not think to verify might still be wrong. Test-first would have narrowed that gap.

## 8.4 What to say to a prospective client

Not "I build dashboards." Instead: "Most businesses your size can tell me what they sold. Very few can tell me whether the number is right, or what to do about it. I connect the systems you already have so the number is trustworthy, and then I show you the three things worth acting on."

Then open the demo, select a tenant, and let the reconciliation flag speak.

---

# PART 9: WHERE TO TAKE IT NEXT

## 9.1 Technical improvements, in order of value

1. **Write tests before transforms** for the remaining work. The two bugs found were both caught by verification, which is a warning about what was not verified.
2. **Incremental loading.** Currently a full rebuild. Real clients need "load yesterday only", which introduces late-arriving data handling and is a genuinely interesting problem.
3. **A data lineage view**, showing for any gold figure which silver rows and which source files produced it. Commercially this is the trust story made visible.
4. **Alerting rather than dashboards.** Most SME owners will not open a dashboard daily. A WhatsApp or email summary that says only what changed and what needs attention is more valuable and more sticky.
5. **dbt, once justified.** Worth learning, worth adopting when transformation logic needs to be tested and shared.
6. **A Power BI version of the same gold layer.** Relatively cheap to build, and it proves the two-tier claim is real rather than theoretical. Same pipeline, either frontend, client chooses.

## 9.2 Analytical extensions

- **Forecasting** footfall from season, weather and events. A natural home for the first machine learning that actually earns its place.
- **Tenant placement analysis**: does proximity to a gate or an anchor tenant predict sales per square metre?
- **Weather elasticity**: quantifying how many visitors each degree above 40C costs, which turns into a staffing rule.
- **Cohort analysis on memberships**, since the snapshot fact already supports it.

## 9.3 Commercial next steps

- Finish the pipeline and publish the portfolio piece.
- Record a walkthrough video, which converts far better than a static page.
- Re-approach AJRE as a consultant with something visible, never as a candidate asking again.
- Return to Al Bahar with the reconciliation offer, which remains the cheapest highest-value first engagement available.

---

# PART 10: GLOSSARY

**Aggregate fact** A fact table stored above transaction level, for example daily totals by channel, because the detail either does not exist or is not needed.

**Bronze / silver / gold** The three medallion layers: raw as received, cleaned and flagged, modelled for use.

**Business key** The identifier the business uses, for example tenant T3. Contrast with surrogate key.

**Conformed dimension** A dimension shared across several fact tables, so measures from different facts can be compared on the same terms.

**COPY** A Postgres bulk-loading command, far faster than inserting rows one at a time.

**Coverage fact** A fact recording what could have happened, for example a lesson slot with its capacity, so utilization has a denominator.

**Data quality flag** A column marking a row as suspect or adjusted, for example `is_imputed`, rather than deleting the row.

**Dimension** A table of descriptive context: who, what, where, when.

**Fact table** A table of events or measurements, with numbers to aggregate and keys pointing at dimensions.

**Grain** What one row represents. The most important decision in any fact table.

**Idempotent** Safe to run repeatedly with the same result. Re-running must not duplicate rows.

**Imputation** Estimating a missing value rather than leaving a gap. Must always be labelled.

**Lineage** The record of where a figure came from and what was done to it.

**Medallion architecture** The bronze, silver, gold layering pattern.

**Periodic snapshot fact** One row per entity per period, for example one row per contract per month, so "how many active in March" is a simple count.

**Referential integrity** Every key in a fact table exists in the dimension it points to. This is what the five refunds broke.

**SCD Type 2** Slowly Changing Dimension Type 2: keeping history by adding a new row with validity dates when an attribute changes.

**Star schema** Facts in the middle, dimensions around them.

**Surrogate key** An artificial integer key, so one business entity can have multiple historical versions.

**Turnover rent** Rent calculated as a percentage of a tenant's sales above a threshold, which is why tenant sales reporting matters commercially.

---

# APPENDIX: GAPS TO FILL FROM THE REPOSITORY

This document was written from the design and from the verification reports. Confirm or correct the following from the actual code, and add them here:

- Final row counts per gold fact table
- The exact deduplication business key used for POS lines
- The imputation method actually chosen for the dead sensor (mean of same hour same day type, interpolation, or other)
- The precise churn inference rule for null end dates
- Number and type of data quality checks implemented
- Final pipeline runtime after the COPY fix
- Any deviations from this architecture made during sessions 9 to 12

Keeping this appendix current is what turns this document from a snapshot into a reference.
