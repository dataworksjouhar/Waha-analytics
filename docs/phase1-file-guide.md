# Phase 1 File Guide: Explaining Every File Without Notes

This is not a design document, it is a rehearsal script. For every file in the
repo it gives you the plain-language version: what the file does, why it
exists, and (for the files that would actually come up in an interview) the
one line worth having ready. Read a section, open the real file next to it,
then close this doc and say the explanation out loud. If you can't, that's
the file to go back to.

Language throughout is deliberately Power BI / SQL flavoured, since that is
the background you're translating from.

---

## 0. The blueprint: `config/`

Think of this folder as the parameter table that drives everything else, the
way a Power Query parameter or a DAX disconnected table drives a whole
report. Nothing about *how* the pipeline behaves lives in Python; only *what
values* it uses does. That split is the entire "one template, many configs"
pitch: swap this folder, keep every line of code, and you have a different
client.

**`config/client_waha.yml`**
The one file that makes this a template rather than a one-off script. It
holds the client's name and currency, which source files map to which
transform function, every calendar fact (Ramadan dates, public holidays,
school breaks), every seasonality curve as a handful of anchor points per
venue type, and every "mess" toggle (the dead sensor, the late tenants, the
duplicate invoices) with its own probability and severity. If you ever find
yourself wanting to hardcode a number in Python instead of adding it here,
that's the config model breaking, and it's meant to be caught immediately,
not fixed later.
*Interview line:* "Every business rule in this project is a YAML value, not
a Python constant. A new client is a new config file, not a code change."

**`config/schema/00_bronze.sql`, `01_silver.sql`, `02_gold.sql`, `03_dq.sql`**
Four plain SQL DDL files, applied in that filename order. This is your table
design: bronze holds one raw, all-text staging table per source plus a file
registry; silver holds one cleaned, typed table per conformed entity with
three lineage columns on every table (`_source_file`, `_loaded_at`,
`_dq_flags`); gold holds the star schema (dimensions, then facts); dq holds
one results table. Every statement is `CREATE ... IF NOT EXISTS`, so
re-running the deploy is always safe, the same idea as an idempotent Power
Query refresh that never appends duplicate rows.

---

## 1. The generator: `generator/`

This whole folder answers one question: how do you get two years of
realistic, messy Kuwait retail data without a real client? Nothing here is
random noise pretending to be a business, every number is driven by a cause
(season, weekend, weather, an event) plus a controlled amount of noise on
top, the way a real business actually behaves.

**`generator/calendars.py`**
The foundation every other generator file imports from. Three jobs: build
the daily date spine (one row per day, matching `dim_date`'s columns, with
weekend/Ramadan/holiday/season flags read straight from config); compute a
seasonality multiplier for any date, given a venue "profile" name (park,
equestrian lessons, boarding, gym), by linearly interpolating between the
anchor points in config and wrapping around the year-end so December
connects back to January; and hand out the one shared random number
generator (seeded, so two runs produce identical output). Nothing here is
hardcoded, it all reads `config/client_waha.yml`.
*Interview line:* "Seasonality isn't one shared curve, it's four separate
profiles because a park and a boarding stable behave completely
differently across the year, and that separation is a config choice, not a
code branch."

**`generator/weather.py`**
Daily temperature, dust storms and rain. Reuses `calendars.py`'s same
anchor-point interpolation for the annual temperature curve, so there's no
second hardcoded formula. Dust storms cluster in spring, rain is a
low-probability winter event, both read their probabilities from config.
Clean by design, no imperfections injected, because real external weather
feeds don't arrive corrupted the way an internal spreadsheet does.

**`generator/footfall.py`**
Hourly visitor counts per gate. The chain of causation: base daily
visitors, times the park seasonality factor, times a weekend multiplier,
times weather suppression (extreme heat and dust storms push footfall
down), plus an event uplift, all with noise layered on top so the series
isn't mechanically smooth. That daily total then gets split into 24 hours
using the hourly curve from `calendars.py`, and split again across the four
gates by fixed shares plus a bit of per-gate noise.

**`generator/pos.py`**
Till receipts for the four own-operated venues, in the same column shape a
real D365 export would use. Playground and Farm ticket volume rides on the
footfall already generated at the two gates that feed those venues (a
conversion rate off that day's footfall); gym day passes and equestrian
walk-in sales instead ride their own seasonality profile, since the
turnstile counters don't see gym or stable visits. Everything is generated
in per-day batches with numpy rather than one random draw per transaction,
purely for speed at ~400k rows.

**`generator/web.py`**
Two things: GA4-style session counts by channel and device, and the
bookings those sessions convert into. The one planted "wow" story lives
here: paid_social's conversion rate decays in a straight line over the two
years while its session volume stays flat, so the channel looks healthy on
volume alone and only reveals the problem once you compute conversion,
exactly the kind of thing a marketing budget keeps funding long after it
should have been cut.

**`generator/tenants.py`**
The true, clean monthly sales figure for each of the ten leased tenants,
before any of the reporting mess is layered on. Each tenant's sales are a
calibrated average scaled by the same park seasonality curve driving
footfall, so tenant performance genuinely tracks visitor volume. One tenant
(T06) is deliberately set to report only 60% of its true sales every month,
that's the planted "who's under-reporting" story the dashboard is meant to
surface later.

**`generator/contracts.py`**
Gym memberships, equestrian club memberships and horse boarding, built as a
month-by-month cohort simulation: each month some active contracts churn
and some new ones start, so member tenure varies naturally instead of being
scripted. Annual gym contracts get their own renewal logic (a probability
of renewing at term end rather than a flat churn rate). Every contract
starts with a null `end_date`, because that's simply what "still active"
means at generation time; the deliberate data errors (a cancellation dated
before the start date, a duplicate identity) are `mess.py`'s job, not this
file's.

**`generator/lessons.py`**
The riding school's daily schedule: fixed slot counts per level, with
booked count driven by capacity times a per-level target utilization times
the equestrian seasonality factor. The target utilization numbers
themselves (92% for beginner, 45% for advanced) are the planted insight,
not just seasonal noise, that's what makes it a real scheduling and pricing
problem rather than a one-off bad month.

**`generator/mess.py`**
Takes every clean DataFrame from the files above and, function by function,
corrupts *how the data arrives* without ever touching the true underlying
numbers. A dead sensor gets 48 hours of nulls, a different sensor
double-counts for two weeks, gate names rotate between three different
spellings, POS lines get duplicated and refunded, tenant files get mixed
date formats and column names and arrive late, contract phone numbers get
deliberately collided across two systems. Every single one of these is
behind its own on/off toggle in config, so the same generator can produce
clean data (for testing) or messy data (for the real demo).
*Interview line:* "None of the imperfections change the true number, they
only change how honestly or dishonestly that number arrives, which is
exactly what real source systems do."

**`generator/generate.py`**
The single entry point (`python generator/generate.py`). It calls every
builder function above in order, applies `mess.py` if the config toggle is
on, and writes everything to `data/bronze/` in the exact file shapes a real
client would hand you: one CSV per day for the daily-drop sources, one
snapshot file per month for contracts, one file per tenant per month for
tenant submissions, static files for events and master data. `data/bronze/`
is wiped and rebuilt from scratch on every run, so two runs never mix rows
from different generations.

---

## 2. Shared pipeline plumbing: `pipeline/db.py`, `pipeline/util.py`

**`pipeline/db.py`**
One function, `get_engine()`, that reads the database connection string
from `.env` and returns a SQLAlchemy engine, the equivalent of a Power BI
data source connection object. It also has `with_retries()`, which wraps any
database call and retries it with growing backoff, because the free-tier
Supabase connection pooler occasionally drops connections mid-query. Every
other file in `pipeline/` goes through this rather than opening its own
connection.

**`pipeline/util.py`**
Two shared helpers every silver and gold build uses: `read_table()`, which
pulls a whole table into a pandas DataFrame using a server-side cursor so a
310,000-row table doesn't blow past Postgres's 2-minute statement timeout;
and `replace_table()`, which truncates the target table and reloads it in
one transaction using Postgres's `COPY` command (much faster than row-by-row
inserts). This truncate-and-reload pattern is *why* the whole pipeline is
idempotent: every silver and gold table is fully rebuilt from the layer
below it on every run, so there's no incremental logic that could
accidentally duplicate a row.
*Interview line:* "Idempotency here isn't a special mechanism, it's a
side effect of always doing a full rebuild from the layer underneath. The
thing that actually can't duplicate is bronze, which dedupes on a file
checksum instead."

---

## 3. Bronze extract: `pipeline/extract/`

**`pipeline/extract/deploy_schema.py`**
Applies the four DDL files in `config/schema/`, in filename order. Nothing
clever, it exists so the schema can be (re)created with one command
(`python -m pipeline.extract.deploy_schema`) instead of you pasting SQL by
hand.

**`pipeline/extract/bronze_extract.py`**
Scans every file under `data/bronze/`, registers it in
`bronze.file_registry` (filename, checksum, row count, status), and loads
its raw contents into the matching bronze staging table with zero
transformation, every column stays text. The idempotency trick: a file
whose checksum already matches a "processed" registry row is skipped
entirely, so re-running never doubles anything; a file whose content
*changed* gets its old rows deleted and reloaded. Files are processed in
batches (40 files per transaction) rather than one network round trip per
file, because at ~4,700 files that difference is the gap between minutes
and the better part of an hour against a remote database.
*Interview line:* "Bronze is the one layer that isn't a truncate-and-reload,
because you don't want to re-read 4,700 files every run just to prove
nothing changed. Checksums are the shortcut."

---

## 4. Silver transforms: `pipeline/transform/`

Every file here does the same shape of job: read a bronze table (all text),
cast it to real types, and flag (never silently fix) anything questionable.
Two run-all scripts exist because the sessions that built them were split
that way: `run_silver_structured.py` covers the sources with no real mess
(master data, weather, events, POS, footfall, web), `run_silver_messy.py`
covers the three genuinely tricky ones (tenants, contracts, lessons).

**`pipeline/transform/master_data.py`**
Straight type-casting for the seven reference tables (venues, gates,
products, tenants, stables, instructors, horses). The one thing worth
knowing: `silver.tenants` keeps *one row per SCD2 version*, it does not
collapse the tenant that changed category down to one row, because gold's
SCD2 build in session 10 needs that version history intact.

**`pipeline/transform/weather.py`**
Pure type-casting, no dedup, no flags. Clean source in, clean table out.

**`pipeline/transform/events.py`**
Type-casting plus one flag: an event whose `end_date` is before its
`start_date` gets `_dq_flags = [end_before_start]`. It is never silently
swapped back, correcting it would erase the exact problem the demo exists
to surface.

**`pipeline/transform/pos_sales.py`**
Two real decisions here. First, `venue_id` comes straight from D365's
`INVENTLOCATIONID`, no fuzzy matching needed since the generator already
writes a clean venue code there. Second, duplicate detection: `mess.py`
creates duplicates by copying a row byte-for-byte, so the dedup key is
every business column together; the first occurrence in a group is kept as
real, every later one is flagged `is_duplicate = true` but *not deleted*,
so the raw evidence of the export overlap stays queryable in silver even
though gold will filter it out.

**`pipeline/transform/footfall.py`**
The most interesting silver file, worth being able to walk through in
detail:
- *Gate name conforming:* the sensor's `sensor_id` (G01-G04) is always
  reliable; the free-text `gate_name` rotates between three spellings
  across files. Rather than trusting either blindly, `gate_id` is taken
  from `sensor_id`, and `gate_name` is checked against an alias table as a
  cross-check, flagging anything that doesn't resolve.
- *Dead sensor imputation:* each null reading is filled with the mean of
  that same gate and hour-of-day across the surrounding two weeks (plus
  and minus 7 calendar days), which follows the hour-of-day pattern
  without being noisy the way copying a single neighbouring day would be.
  Flagged `is_imputed = true`.
- *Double-counting detection:* a rolling median per gate, hour and
  weekday-vs-weekend (61 readings wide) is computed, and anything more
  than 1.5x that baseline gets replaced with the median and flagged
  `is_outlier_corrected = true`. Splitting weekend from weekday matters a
  lot here: Kuwaiti weekends run about 1.6x weekday footfall, so a median
  blended across both day types would sit below every real weekend reading
  and falsely flag the whole weekend as an outlier.
*Interview line:* "The outlier rule isn't a fixed threshold on raw counts,
it's a threshold on the ratio to a same-day-type rolling median, because a
normal Friday and a broken Tuesday look completely different in absolute
terms."

**`pipeline/transform/web.py`**
Web sessions are a clean cast. Web bookings get two flags: a missing
channel (`channel_missing`, direct attribution loss, never guessed at) and
`is_cancelled`, derived from a negative amount rather than a status column,
since that's how the source system actually represents a cancellation, as
a second row, not an edit to the first.

**`pipeline/transform/tenant_sales.py`**
The showcase mess, resolved. Bronze already parsed `tenant_id` and
`sales_month` from the filename and grabbed whatever `gross_sales` /
`net_sales` / date columns existed for that tenant; silver's job is
everything after that. Dates are tried against three formats in turn (ISO,
day/month/year, "Month Year") without silver ever being told which tenant
uses which, it just keeps whichever format parses. Weekly rows (one tenant
reports four rows a month instead of one) get summed into a single
tenant-month figure, using `min_count=1` in the sum so a tenant who simply
never reports net sales shows as genuinely missing, not a false zero.
`submission_version` is 1 for an original submission and 2 for a
restatement, both are kept, "which one is current" is decided later in
gold.

**`pipeline/transform/contracts.py`**
Each monthly contract export is a full re-export of every contract's
current state, so silver keeps only the *latest* file each `contract_id`
appears in (files sort chronologically by name, so "last file" is reliably
"most recent state"). Two flags, both left uncorrected: a cancellation
dated before the start date (`cancellation_before_start`), and a phone
number shared by more than one `member_id` (`shared_phone_across_members`,
the two-systems-one-person case). The actual identity merge onto one
canonical member happens in gold's `dim_member`, not here, silver's job is
only to surface the collision.

**`pipeline/transform/lessons.py`**
Missing `attended` values are kept as null (the null itself is the
signal, no separate flag needed). Overbooked slots (`booked > capacity`)
are kept exactly as reported and flagged `is_overbooked`, never clamped
down to capacity, because silently capping it would erase the exact
problem the utilization metric is meant to catch.

**`pipeline/transform/run_silver_structured.py`** and
**`run_silver_messy.py`**
Two orchestration scripts, no logic of their own, they just call the
functions above in the right order and print row counts. Split into two
files because that's how the work was reviewed session by session, not for
any technical reason.

---

## 5. Gold dimensions: `pipeline/load/dim_*.py`, `run_gold_dims.py`

**`pipeline/load/dim_date.py`**
Builds `dim_date` by calling `generator.calendars.build_date_spine()`
again, the same function the generator itself uses, rather than
reimplementing the calendar rules a second time. Also builds
`dim_date_weather`, a 1:1 extension table kept separate from `dim_date` so
the date dimension itself stays generic and reusable by a future client
that has no weather data at all.

**`pipeline/load/dim_simple.py`**
Every "Type 1" dimension that carries no history: venue, gate, product,
stable, instructor, event, channel. Most are a straight copy from their
silver table with a surrogate key added. `dim_channel` is the odd one out,
there's no source master file for "channel" anywhere upstream, it's only
ever an attribute on a session or booking row, so this file builds it by
finding every distinct channel value that actually appears.

**`pipeline/load/dim_tenant.py`, the SCD Type 2 dimension**
This is the one to have fully rehearsed. `silver.tenants` already carries
one row per tenant *version* (the source master file itself encodes
`effective_start_date` / `effective_end_date` per version), so the mapping
is direct:
```
valid_from  = effective_start_date
valid_to    = effective_end_date
is_current  = effective_end_date IS NULL
```
There's no "compare the new row against what's already there" merge logic
to write, because the whole pipeline rebuilds gold from silver on every
run rather than loading incrementally. Two real cases worth naming by
tenant ID if asked: **T09** genuinely has two adjacent, non-overlapping
versions (category changes from "Retail - Specialty" to "Retail - Fashion"
on 2025-06-01). **T04** is *not* two versions, it's one row with
`status = 'closed'`, because the source only ever gave us its final closed
state, not a history of active-then-closed, so `is_current = true` is
still correct there, it means "latest known version of the record," not
"currently open."
*Interview line, the one they'll actually ask:* "How would you handle a
late-arriving change?" Answer: find which existing version's
`[valid_from, valid_to)` window contains the newly-discovered effective
date, split that window into two (the old version now ends the day before
the new effective date, the new version fills the gap), and then, the hard
part, re-point any fact rows from that period that already joined to the
old version's surrogate key, because a key baked into a fact table doesn't
update itself just because the dimension grew a new version underneath it.

**`pipeline/load/dim_customer.py`**
Online customers only, built from the earliest booking date per
`customer_id`. Walk-in customers never appear here at all, on purpose,
that gap is an honest reflection of what the data can support (POS sales
carry no customer identity), not something to paper over with a fake
"unknown customer" row.

**`pipeline/load/dim_member.py`**
The identity resolution step promised in the architecture doc. Contracts
sharing the same phone number collapse to one canonical `member_id` (the
lowest ID in that phone group, arbitrary but consistent), so someone
holding both a gym and an equestrian membership under two different source
IDs becomes one row here. The resolution function is written once and
exported, so `fact_membership_months` can call the exact same logic later
rather than risking a second, possibly inconsistent, version of the merge.

**`pipeline/load/run_gold_dims.py`**
Orchestration only: runs `dim_date` before `dim_date_weather`, `dim_venue`
before `dim_product` (a real foreign key dependency), then everything else.

---

## 6. Gold facts: `pipeline/load/fact_*.py`, `run_gold_facts.py`, `run_gold.py`

**`pipeline/load/fact_pos_sales.py`**
Invoice-line grain, a transaction fact. Drops `is_duplicate` rows here
(silver kept them visible, gold must not double-count revenue). Looks up
`venue_key` and `product_key` by plain equality joins, no crosswalk needed
since D365's item ID is already the product's true ID.

**`pipeline/load/fact_footfall.py`**
Gate-by-hour grain, an aggregate/coverage fact. A direct mapping from
silver, the imputation and outlier flags carry straight through as
first-class gold columns, not silver-only bookkeeping.

**`pipeline/load/fact_tenant_sales.py`**
The one fact table that has to join correctly against an SCD Type 2
dimension. `tenant_key` cannot come from a plain join on `tenant_id`,
because a two-version tenant like T09 would produce two fact rows for one
real sale. The correct join is point-in-time: find the `dim_tenant` row
whose `[valid_from, valid_to]` window actually contains that sale's month.
This exact logic is pulled into its own function
(`join_tenant_version`) specifically so it could be unit tested without a
database, see `tests/test_fact_tenant_sales.py` below.

**`pipeline/load/fact_bookings.py`**
Booking grain, a transaction fact. The one real wrinkle: the website's
`product_code` ("playground_ticket") is one level less specific than
`dim_product`'s SKU ("playground_ticket_adult"), because checkout never
captured which exact SKU a customer chose. A documented crosswalk
(`BOOKING_PRODUCT_FAMILY`) maps each family to one representative SKU,
which is fine because none of the twelve business questions need
booking-level SKU precision, only the venue and category, which are
identical across every SKU in a family.

**`pipeline/load/fact_web_sessions.py`**
Date x channel x device grain, an aggregate fact by design, GA4-style
exports arrive pre-aggregated, there's no session-level row underneath to
grain down to.

**`pipeline/load/fact_membership_months.py`, the periodic snapshot fact**
The other file worth fully rehearsing. `silver.contracts` only has the
*latest* known state per contract, there is no month-by-month history
sitting in a table to copy from. This file reconstructs that history in
pandas by cross-joining every contract against every month in the data
window and then filtering down to the months each contract was actually
active. Four rules make that reconstruction correct, and each has its own
pytest case:
1. The window has edges. A contract that started before July 2024 (the
   data window's start) still generates rows from July 2024 onward, not
   from its true start, but is never marked `is_new` for that first row,
   because it wasn't actually acquired then.
2. Symmetrically, a contract with no end date, or an end date past July
   2026, generates rows up to the window's last month, and is never marked
   `is_churned`, because nothing in the data actually says it ended.
3. `is_new` fires only on the contract's true start month, `is_churned`
   only on its true end month, both derived from the real dates, not from
   the window boundary. A contract can be both in the same row if it
   started and ended inside one calendar month.
4. `mrr_kwd` is the full monthly amount for every month generated, no
   proration for a partial first or last month, matching how MRR is
   conventionally reported.
*Interview line:* "This is a periodic snapshot fact reconstructed from a
single current-state table, not copied from monthly history that doesn't
exist in the source. The interesting logic is entirely in
`explode_contract_months`, which is why that function is split out and
unit tested on its own."

**`pipeline/load/fact_lesson_slots.py`**
Lesson-slot grain, a capacity/coverage fact. Supplies only the denominator
side of utilization (booked, capacity, attended), lesson *revenue* lives in
`fact_bookings` as a package purchase, this file is the other half of the
deliberate "revenue in one system, capacity in another" split described in
the architecture doc.

**`pipeline/load/run_gold_facts.py`**
Runs all seven fact builds in the order the architecture doc lists them.
No functional dependency between facts, just for readability.

**`pipeline/load/run_gold.py`**
The real entry point once facts exist. Runs dims, then facts, in one pass.
The reason this has to be one combined script rather than two separate
commands: every fact's foreign key points at a dimension, so reloading a
dimension alone requires `TRUNCATE ... CASCADE`, which would wipe every
fact row that referenced it. Running dims and facts together in one script
means a dimension reload is always immediately followed by a full fact
rebuild in the same run, so nothing is ever left dangling.

---

## 7. Data quality: `pipeline/dq/checks.py`

One module, five check types (matching the architecture doc), two
severities. **Error severity** (uniqueness, referential integrity) means an
invariant the code should always satisfy if it's working correctly, so a
failure here stops the pipeline. **Warning severity** (row count, value
range, freshness) means something that can legitimately drift a little
without anything actually being broken, so it's reported but never blocks
the run. Every check writes one row to `dq.check_results`, pass or fail,
which is append-only, unlike silver and gold it is never truncated, it's
the permanent audit trail.

One thing worth knowing if asked "isn't this redundant with your foreign
key constraints?": yes, every referential integrity check here duplicates
a live FK already declared in the gold DDL, Postgres would refuse the bad
row before it ever landed. They're kept anyway because they're the honest
place to demonstrate the check, and because they're exactly the kind of
check that would have caught a couple of this project's own real bugs (a
null date key, a mismatched column type) before they turned into a crashed
load.

---

## 8. The orchestrator: `pipeline/run.py`

The single command (`python -m pipeline.run`) that runs everything in
order: deploy schema, bronze extract, silver, a DQ gate, gold dimensions,
gold facts, a second DQ gate, then a summary. Two gates, not one at the
end, because a broken silver load should stop the run before gold spends
minutes rebuilding facts from bad input. A gate only actually halts the run
on an error-severity failure, warning-severity failures print in the
summary but never block progress. Exits with code 0 on a clean pass, 1 on
an error-severity failure, so it behaves correctly in a CI pipeline later.

---

## 9. Tests: `tests/`

Each test file targets one piece of logic that is easy to get subtly wrong
in a way that doesn't crash, it just quietly returns the wrong number.

**`tests/test_calendars.py`**
Checks the date spine has no gaps, the Kuwaiti weekend really is Friday and
Saturday only, Ramadan and public holiday flags match config exactly, the
four seasonality profiles behave the way CLAUDE.md specifies (park peaks
winter and troughs summer, boarding is flat, gym has a January spike,
equestrian's summer dip is shallower than the park's), and the random seed
is genuinely deterministic across calls.

**`tests/test_tenant_sales_conform.py`**
Confirms the mixed-date-format parser correctly handles all three tenant
date styles (ISO, day/month/year, "Month Year") independently, without
being told in advance which tenant uses which.

**`tests/test_fact_tenant_sales.py`**
The SCD2 point-in-time join, tested against a small synthetic `dim_tenant`
with no database involved: a sale before the category change resolves to
the first version's key, a sale on the change month resolves to the second,
a two-version tenant never produces two rows for one sale, and a
single-version tenant still resolves normally.

**`tests/test_fact_membership_months.py`**
The four reconstruction rules from `fact_membership_months.py`, each as its
own test: an open-ended contract runs to the window's end without
churning; a cancelled contract churns exactly once, on its true end month;
a contract that predates the window generates from the window's start but
is never flagged `is_new`; a contract starting and ending in the same month
is flagged both new and churned; MRR is never prorated.

---

## Appendix: five questions an interviewer will actually ask, and where the answer lives

**"Walk me through your medallion architecture."**
Bronze (`config/schema/00_bronze.sql`, `pipeline/extract/bronze_extract.py`)
is raw, all-text, immutable, deduped only on file checksum. Silver
(`config/schema/01_silver.sql`, `pipeline/transform/`) is cleaned, typed,
flagged, never silently corrected. Gold (`config/schema/02_gold.sql`,
`pipeline/load/`) is the star schema, dimensions then facts, built by fully
rebuilding from silver on every run.

**"What's an SCD Type 2 and how did you build one?"**
`pipeline/load/dim_tenant.py`. Answer using T09 as the concrete example, and
have the late-arriving-change answer ready (see section 5 above), that's
the actual follow-up question.

**"How do you guarantee idempotency?"**
`pipeline/util.py`'s `replace_table()`: silver and gold are always a full
truncate-and-reload from the layer beneath them, so there's nothing
incremental that could double a row. Bronze is the exception, and it
guarantees idempotency a different way, checksum-based skip logic in
`bronze_extract.py`.

**"What fact table types did you use, and why does that matter?"**
Four types, deliberately: transaction fact (`fact_pos_sales`,
`fact_bookings`, one row per real event), periodic snapshot
(`fact_membership_months`, one row per contract per month, reconstructed
from a current-state table), aggregate (`fact_web_sessions`, pre-aggregated
at the source), and capacity/coverage (`fact_lesson_slots`, booked versus
capacity, not a revenue fact at all). Naming and justifying all four in one
warehouse is the actual senior-level signal here, not any one of them alone.

**"Give me one data quality problem, start to finish."**
The dead sensor is the cleanest example to narrate: planted in
`config/client_waha.yml` (`mess.footfall.dead_sensor`), injected in
`generator/mess.py` (`inject_footfall_mess`), detected and imputed in
`pipeline/transform/footfall.py` (`_impute_gate_hour_series`, filled from
the surrounding two weeks at the same gate and hour, flagged
`is_imputed`), and carried through unchanged into
`pipeline/load/fact_footfall.py` as a first-class gold column, so anyone
querying the gold layer can see exactly which footfall numbers were
imputed rather than measured.
