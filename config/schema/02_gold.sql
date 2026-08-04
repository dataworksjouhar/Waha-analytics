-- Gold layer: the star schema. Dimensions first (surrogate keys, _key
-- suffix), then facts. Facts carry no lineage columns; lineage is a
-- silver-layer concern, gold is meant to be queried by BI tools without
-- that noise. Deliberately mixed fact table types: transaction facts
-- (fact_pos_sales, fact_bookings), a periodic snapshot (fact_membership_months),
-- an aggregate (fact_web_sessions), and a capacity/coverage fact
-- (fact_lesson_slots).

CREATE SCHEMA IF NOT EXISTS gold;

-- ---------------------------------------------------------------------
-- Dimensions
-- ---------------------------------------------------------------------

-- Static, one row per calendar day across the generator's date range.
-- Weekend/Ramadan/holiday flags are populated by the load job from
-- config/client_waha.yml, not hardcoded here, so this table stays
-- reusable across clients.
CREATE TABLE IF NOT EXISTS gold.dim_date (
    date_key           INTEGER PRIMARY KEY,     -- YYYYMMDD
    full_date             DATE NOT NULL UNIQUE,
    year                     INTEGER NOT NULL,
    quarter                    SMALLINT NOT NULL,
    month                        SMALLINT NOT NULL,
    month_name                     TEXT NOT NULL,
    day                               SMALLINT NOT NULL,
    day_of_week                        SMALLINT NOT NULL,   -- ISO: 1=Mon .. 7=Sun
    day_name                             TEXT NOT NULL,
    is_weekend                             BOOLEAN NOT NULL,
    is_ramadan                               BOOLEAN NOT NULL DEFAULT false,
    is_public_holiday                          BOOLEAN NOT NULL DEFAULT false,
    holiday_name                                 TEXT,
    season                                         TEXT      -- winter_peak, summer_trough, shoulder
);

-- 1:1 extension of dim_date, kept separate so dim_date itself stays a
-- generic, weather-free conformed dimension reusable by any client.
CREATE TABLE IF NOT EXISTS gold.dim_date_weather (
    date_key         INTEGER PRIMARY KEY REFERENCES gold.dim_date (date_key),
    temp_max_c          NUMERIC(5,1),
    temp_min_c            NUMERIC(5,1),
    dust_storm_flag         BOOLEAN NOT NULL DEFAULT false,
    rain_mm                   NUMERIC(6,2)
);

CREATE TABLE IF NOT EXISTS gold.dim_venue (
    venue_key       SERIAL PRIMARY KEY,
    venue_id           TEXT NOT NULL UNIQUE,
    venue_name           TEXT NOT NULL,
    venue_type             TEXT NOT NULL,
    opened_date               DATE,
    description                 TEXT
);

CREATE TABLE IF NOT EXISTS gold.dim_gate (
    gate_key       SERIAL PRIMARY KEY,
    gate_id           TEXT NOT NULL UNIQUE,
    gate_name           TEXT NOT NULL,
    description            TEXT
);

CREATE TABLE IF NOT EXISTS gold.dim_product (
    product_key       SERIAL PRIMARY KEY,
    product_id           TEXT NOT NULL UNIQUE,
    product_code           TEXT NOT NULL,
    product_name             TEXT NOT NULL,
    venue_key                   INTEGER REFERENCES gold.dim_venue (venue_key),
    category                      TEXT NOT NULL,
    unit_price_kwd                   NUMERIC(12,3)
);

-- Online customers only; walk-ins are anonymous by design, and that gap
-- is itself an honest modelling point, not an omission.
CREATE TABLE IF NOT EXISTS gold.dim_customer (
    customer_key       SERIAL PRIMARY KEY,
    customer_id            TEXT NOT NULL UNIQUE,
    first_seen_date            DATE
);

CREATE TABLE IF NOT EXISTS gold.dim_event (
    event_key       SERIAL PRIMARY KEY,
    event_id           TEXT NOT NULL UNIQUE,
    event_name           TEXT NOT NULL,
    event_type              TEXT,
    start_date                 DATE NOT NULL,
    end_date                     DATE,
    expected_attendance             INTEGER
);

CREATE TABLE IF NOT EXISTS gold.dim_channel (
    channel_key       SERIAL PRIMARY KEY,
    channel_name          TEXT NOT NULL UNIQUE
);

-- Identity-resolved across gym and equestrian systems on phone number.
-- member_id is the resolved identity; a person holding both a gym and
-- an equestrian membership under two source member IDs collapses to one
-- row here.
CREATE TABLE IF NOT EXISTS gold.dim_member (
    member_key       SERIAL PRIMARY KEY,
    member_id           TEXT NOT NULL UNIQUE,
    phone                  TEXT,
    first_contract_start_date  DATE
);

CREATE TABLE IF NOT EXISTS gold.dim_stable (
    stable_key       SERIAL PRIMARY KEY,
    stable_id           TEXT NOT NULL UNIQUE,
    box_no                 TEXT NOT NULL,
    size_category             TEXT NOT NULL,
    status                      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gold.dim_instructor (
    instructor_key       SERIAL PRIMARY KEY,
    instructor_id            TEXT NOT NULL UNIQUE,
    instructor_name              TEXT NOT NULL,
    specialty_level                 TEXT,
    hire_date                          DATE,
    status                                TEXT NOT NULL
);

-- SCD Type 2. tenant_id is the natural/business key and repeats across
-- versions; tenant_key is the surrogate that facts join to, always
-- pointing at the version that was true at the time of the fact.
CREATE TABLE IF NOT EXISTS gold.dim_tenant (
    tenant_key       SERIAL PRIMARY KEY,
    tenant_id            TEXT NOT NULL,
    tenant_name             TEXT NOT NULL,
    category                   TEXT NOT NULL,
    unit_no                       TEXT NOT NULL,
    unit_sqm                        NUMERIC(8,2),
    lease_start                        DATE,
    lease_end                             DATE,
    base_rent_kwd                            NUMERIC(12,3),
    turnover_rent_pct                          NUMERIC(5,2),
    turnover_threshold_kwd                       NUMERIC(12,3),
    status                                          TEXT NOT NULL,
    valid_from                                        DATE NOT NULL,
    valid_to                                            DATE,
    is_current                                            BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS ix_dim_tenant_tenant_id ON gold.dim_tenant (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dim_tenant_current
    ON gold.dim_tenant (tenant_id) WHERE is_current;

-- ---------------------------------------------------------------------
-- Facts
-- ---------------------------------------------------------------------

-- Transaction fact, invoice line grain. Refunds are negative rows, never
-- dropped, so the same fact table nets to true revenue.
CREATE TABLE IF NOT EXISTS gold.fact_pos_sales (
    pos_sales_key       BIGSERIAL PRIMARY KEY,
    invoice_id               TEXT NOT NULL,
    date_key                    INTEGER NOT NULL REFERENCES gold.dim_date (date_key),
    venue_key                      INTEGER REFERENCES gold.dim_venue (venue_key),
    product_key                       INTEGER REFERENCES gold.dim_product (product_key),
    qty                                  NUMERIC(10,2) NOT NULL,
    sales_price_kwd                        NUMERIC(12,3) NOT NULL,
    line_amount_kwd                           NUMERIC(12,3) NOT NULL,
    payment_mode                                 TEXT,
    is_refund                                       BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ix_fact_pos_sales_date ON gold.fact_pos_sales (date_key);
CREATE INDEX IF NOT EXISTS ix_fact_pos_sales_venue ON gold.fact_pos_sales (venue_key);

-- Aggregate/coverage fact, gate x hour grain.
CREATE TABLE IF NOT EXISTS gold.fact_footfall (
    footfall_key       BIGSERIAL PRIMARY KEY,
    date_key               INTEGER NOT NULL REFERENCES gold.dim_date (date_key),
    gate_key                  INTEGER NOT NULL REFERENCES gold.dim_gate (gate_key),
    hour                          SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
    count_in                        INTEGER,
    count_out                          INTEGER,
    is_imputed                            BOOLEAN NOT NULL DEFAULT false,
    is_outlier_corrected                     BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (gate_key, date_key, hour)
);

CREATE INDEX IF NOT EXISTS ix_fact_footfall_date ON gold.fact_footfall (date_key);

-- Tenant x month x version grain. All versions are kept, current-version
-- reporting is a view on top (sql/), so turnover rent history and
-- restatement patterns stay queryable.
CREATE TABLE IF NOT EXISTS gold.fact_tenant_sales (
    tenant_sales_key       BIGSERIAL PRIMARY KEY,
    tenant_key                 INTEGER NOT NULL REFERENCES gold.dim_tenant (tenant_key),
    month_date_key                 INTEGER NOT NULL REFERENCES gold.dim_date (date_key), -- first of month
    submission_version                  INTEGER NOT NULL,
    gross_sales_kwd                        NUMERIC(12,3),
    net_sales_kwd                             NUMERIC(12,3),
    submitted_date                              DATE NOT NULL,
    days_late                                     INTEGER,
    is_restated                                     BOOLEAN NOT NULL DEFAULT false,
    is_current_version                                BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (tenant_key, month_date_key, submission_version)
);

-- Transaction fact, booking grain. Cancellations arrive as negative
-- amounts and are flagged, not dropped.
CREATE TABLE IF NOT EXISTS gold.fact_bookings (
    booking_key       BIGSERIAL PRIMARY KEY,
    booking_id            TEXT NOT NULL UNIQUE,
    date_key                 INTEGER NOT NULL REFERENCES gold.dim_date (date_key),
    product_key                 INTEGER REFERENCES gold.dim_product (product_key),
    channel_key                    INTEGER REFERENCES gold.dim_channel (channel_key),
    customer_key                      INTEGER REFERENCES gold.dim_customer (customer_key),
    qty                                  NUMERIC(10,2) NOT NULL,
    amount_kwd                              NUMERIC(12,3) NOT NULL,
    is_cancelled                               BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ix_fact_bookings_date ON gold.fact_bookings (date_key);

-- Aggregate fact by design: date x channel x device grain, not session
-- level. Matches GA4-style exports, which arrive pre-aggregated.
CREATE TABLE IF NOT EXISTS gold.fact_web_sessions (
    web_session_key       BIGSERIAL PRIMARY KEY,
    date_key                  INTEGER NOT NULL REFERENCES gold.dim_date (date_key),
    channel_key                  INTEGER REFERENCES gold.dim_channel (channel_key),
    device                          TEXT,
    sessions                           INTEGER,
    engaged_sessions                      INTEGER,
    users                                    INTEGER
);

-- Periodic snapshot fact, contract x month grain. Gym memberships,
-- equestrian club memberships, and horse boarding are all the same
-- member-month recurring-revenue shape, so they share this one table
-- rather than three.
CREATE TABLE IF NOT EXISTS gold.fact_membership_months (
    membership_month_key       BIGSERIAL PRIMARY KEY,
    contract_id                    TEXT NOT NULL,
    member_key                        INTEGER NOT NULL REFERENCES gold.dim_member (member_key),
    venue_key                            INTEGER REFERENCES gold.dim_venue (venue_key),
    month_date_key                          INTEGER NOT NULL REFERENCES gold.dim_date (date_key), -- first of month
    contract_type                              TEXT NOT NULL,   -- gym_monthly, gym_annual, equestrian_club, horse_boarding
    stable_key                                    INTEGER REFERENCES gold.dim_stable (stable_key), -- boarding only
    mrr_kwd                                          NUMERIC(12,3) NOT NULL,
    status                                              TEXT NOT NULL,
    is_new                                                 BOOLEAN NOT NULL DEFAULT false,
    is_churned                                               BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (contract_id, month_date_key)
);

CREATE INDEX IF NOT EXISTS ix_fact_membership_months_month ON gold.fact_membership_months (month_date_key);

-- Capacity/coverage fact, lesson slot grain. booked/capacity gives
-- utilization, attended/booked gives no-show rate.
CREATE TABLE IF NOT EXISTS gold.fact_lesson_slots (
    lesson_slot_key       BIGSERIAL PRIMARY KEY,
    lesson_id                 TEXT NOT NULL UNIQUE,
    date_key                     INTEGER NOT NULL REFERENCES gold.dim_date (date_key),
    instructor_key                  INTEGER REFERENCES gold.dim_instructor (instructor_key),
    level                               TEXT,
    capacity                              INTEGER NOT NULL,
    booked                                   INTEGER NOT NULL,
    attended                                    INTEGER,
    is_overbooked                                  BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ix_fact_lesson_slots_date ON gold.fact_lesson_slots (date_key);


-- ---------------------------------------------------------------------
-- Spatial metadata columns (added after the initial build)
-- ---------------------------------------------------------------------
--
-- ALTER ... ADD COLUMN IF NOT EXISTS rather than editing the CREATE TABLE
-- statements above, because every statement in this file is IF NOT EXISTS:
-- a CREATE TABLE that already exists is skipped entirely, so a column added
-- to its body would reach a fresh database and never reach this one. The
-- ALTER runs either way, which is what makes deploy_schema safe to re-run
-- against a warehouse that is already built.
--
-- Values are NOT set here. They come from the `spatial` section of
-- config/client_waha.yml and are applied by the gold dimension loaders, so
-- the layout of a client's site stays a config fact rather than DDL.

-- Four physical counter sensors, two logical entrances. gate_label is the
-- rollup; gate_name stays the sensor the source files are keyed to.
-- primary_venue_served is null where a gate serves the whole site, which is
-- a meaningful value here and not a gap.
ALTER TABLE gold.dim_gate  ADD COLUMN IF NOT EXISTS gate_label           TEXT;
ALTER TABLE gold.dim_gate  ADD COLUMN IF NOT EXISTS zone                 TEXT;
ALTER TABLE gold.dim_gate  ADD COLUMN IF NOT EXISTS primary_venue_served TEXT;

ALTER TABLE gold.dim_venue ADD COLUMN IF NOT EXISTS zone            TEXT;
ALTER TABLE gold.dim_venue ADD COLUMN IF NOT EXISTS gate_proximity  TEXT;

-- dim_tenant is SCD Type 2, so these columns repeat across a tenant's
-- versions. That is correct rather than sloppy: a unit does not move when a
-- tenant changes category, so the attribute is genuinely the same in every
-- version. Zone belongs to the unit, and it is carried on the tenant row
-- because unit_no already is.
ALTER TABLE gold.dim_tenant ADD COLUMN IF NOT EXISTS zone            TEXT;
ALTER TABLE gold.dim_tenant ADD COLUMN IF NOT EXISTS gate_proximity  TEXT;
