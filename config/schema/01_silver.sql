-- Silver layer: cleaned, typed, deduplicated, conformed entities. One table
-- per source entity described in docs/phase0-architecture.md section 3.
-- Every table carries the same three lineage columns so any row can be
-- traced back to the file it came from and what, if anything, was wrong
-- with it: _source_file, _loaded_at, _dq_flags. Imperfections are flagged
-- here, never silently dropped.

CREATE SCHEMA IF NOT EXISTS silver;

-- ---------------------------------------------------------------------
-- Master data staging (Source 9). Type 1 as staged; dim_tenant's SCD2
-- versioning happens in the gold build, not here.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS silver.venues (
    venue_id        TEXT PRIMARY KEY,
    venue_name       TEXT NOT NULL,
    venue_type        TEXT NOT NULL,
    opened_date        DATE,
    description          TEXT,
    _source_file           TEXT NOT NULL,
    _loaded_at              TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS silver.gates (
    gate_id         TEXT PRIMARY KEY,
    gate_name        TEXT NOT NULL,
    description        TEXT,
    _source_file          TEXT NOT NULL,
    _loaded_at             TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags               TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS silver.products (
    product_id       TEXT PRIMARY KEY,
    product_code      TEXT NOT NULL,
    product_name       TEXT NOT NULL,
    venue_id             TEXT,
    category               TEXT NOT NULL,
    unit_price_kwd           NUMERIC(12,3),
    _source_file               TEXT NOT NULL,
    _loaded_at                  TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                     TEXT[] NOT NULL DEFAULT '{}'
);

-- One row per tenant *version*. tenant_id repeats where category changed
-- (see effective_start_date / effective_end_date). This is the raw input
-- the gold SCD2 build reads to construct dim_tenant's valid_from/valid_to.
CREATE TABLE IF NOT EXISTS silver.tenants (
    silver_tenant_id      BIGSERIAL PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    tenant_name               TEXT NOT NULL,
    category                    TEXT NOT NULL,
    unit_no                       TEXT NOT NULL,
    unit_sqm                        NUMERIC(8,2),
    lease_start                       DATE,
    lease_end                           DATE,
    base_rent_kwd                         NUMERIC(12,3),
    turnover_rent_pct                       NUMERIC(5,2),
    turnover_threshold_kwd                    NUMERIC(12,3),
    status                                       TEXT NOT NULL,
    effective_start_date                           DATE NOT NULL,
    effective_end_date                               DATE,
    _source_file                                       TEXT NOT NULL,
    _loaded_at                                           TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                                              TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS silver.stables (
    stable_id       TEXT PRIMARY KEY,
    box_no            TEXT NOT NULL,
    size_category       TEXT NOT NULL,
    status                TEXT NOT NULL,
    _source_file            TEXT NOT NULL,
    _loaded_at                TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                   TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS silver.instructors (
    instructor_id     TEXT PRIMARY KEY,
    instructor_name     TEXT NOT NULL,
    specialty_level       TEXT NOT NULL,
    hire_date               DATE,
    status                     TEXT NOT NULL,
    _source_file                 TEXT NOT NULL,
    _loaded_at                     TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                        TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS silver.horses (
    horse_id           TEXT PRIMARY KEY,
    horse_name           TEXT NOT NULL,
    breed                   TEXT,
    level_suitability          TEXT,
    stable_id                    TEXT,
    _source_file                    TEXT NOT NULL,
    _loaded_at                        TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                           TEXT[] NOT NULL DEFAULT '{}'
);

-- ---------------------------------------------------------------------
-- Transactional and periodic sources (Sources 1, 2, 3, 4, 5, 6, 7, 8)
-- ---------------------------------------------------------------------

-- Source 1: D365 POS sales lines, own-operated venues.
CREATE TABLE IF NOT EXISTS silver.pos_sales_lines (
    silver_pos_sales_line_id   BIGSERIAL PRIMARY KEY,
    invoice_id                    TEXT NOT NULL,
    sales_id                        TEXT NOT NULL,
    invoice_date                      DATE NOT NULL,
    item_id                             TEXT NOT NULL,
    item_name                             TEXT,
    qty                                     NUMERIC(10,2) NOT NULL,
    sales_price_kwd                           NUMERIC(12,3) NOT NULL,
    line_amount_kwd                             NUMERIC(12,3) NOT NULL,
    venue_id                                      TEXT,          -- conformed from INVENTSITEID/INVENTLOCATIONID
    cust_account                                    TEXT,
    payment_mode                                      TEXT,
    created_datetime                                    TIMESTAMP,
    is_refund                                             BOOLEAN NOT NULL DEFAULT false,
    is_duplicate                                            BOOLEAN NOT NULL DEFAULT false,
    _source_file                                              TEXT NOT NULL,
    _loaded_at                                                  TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                                                     TEXT[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS ix_pos_sales_lines_invoice_date ON silver.pos_sales_lines (invoice_date);

-- Source 2: footfall counters, gate x hour grain.
CREATE TABLE IF NOT EXISTS silver.footfall_hourly (
    silver_footfall_id     BIGSERIAL PRIMARY KEY,
    sensor_id                 TEXT NOT NULL,
    gate_id                     TEXT NOT NULL,      -- conformed gate name
    footfall_date                 DATE NOT NULL,
    hour                             SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
    count_in                           INTEGER,
    count_out                            INTEGER,
    is_imputed                             BOOLEAN NOT NULL DEFAULT false,
    is_outlier_corrected                     BOOLEAN NOT NULL DEFAULT false,
    _source_file                               TEXT NOT NULL,
    _loaded_at                                   TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                                      TEXT[] NOT NULL DEFAULT '{}',
    UNIQUE (gate_id, footfall_date, hour)
);

-- Source 3: tenant monthly sales submissions, versioned by restatement.
CREATE TABLE IF NOT EXISTS silver.tenant_sales_monthly (
    silver_tenant_sales_id   BIGSERIAL PRIMARY KEY,
    tenant_id                   TEXT NOT NULL,
    sales_month                   DATE NOT NULL,        -- first of month
    gross_sales_kwd                 NUMERIC(12,3),
    net_sales_kwd                     NUMERIC(12,3),
    submitted_date                      DATE NOT NULL,
    submission_version                    INTEGER NOT NULL DEFAULT 1,
    days_late                               INTEGER,
    is_restated                               BOOLEAN NOT NULL DEFAULT false,
    _source_file                                TEXT NOT NULL,
    _loaded_at                                    TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                                       TEXT[] NOT NULL DEFAULT '{}',
    UNIQUE (tenant_id, sales_month, submission_version)
);

-- Source 4: booking website.
CREATE TABLE IF NOT EXISTS silver.web_sessions (
    silver_web_session_id   BIGSERIAL PRIMARY KEY,
    session_date                DATE NOT NULL,
    channel                        TEXT,
    device                            TEXT,
    sessions                            INTEGER,
    engaged_sessions                      INTEGER,
    users                                    INTEGER,
    _source_file                              TEXT NOT NULL,
    _loaded_at                                  TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                                     TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS silver.web_bookings (
    silver_web_booking_id   BIGSERIAL PRIMARY KEY,
    booking_id                  TEXT NOT NULL,
    booking_datetime               TIMESTAMP NOT NULL,
    product_code                     TEXT NOT NULL,
    qty                                 NUMERIC(10,2) NOT NULL,
    amount_kwd                            NUMERIC(12,3) NOT NULL,
    channel                                 TEXT,          -- nullable: direct attribution loss
    customer_id                               TEXT,
    is_cancelled                                BOOLEAN NOT NULL DEFAULT false,
    _source_file                                  TEXT NOT NULL,
    _loaded_at                                      TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                                         TEXT[] NOT NULL DEFAULT '{}',
    UNIQUE (booking_id)
);

-- Source 5: events calendar.
CREATE TABLE IF NOT EXISTS silver.events (
    silver_event_id   BIGSERIAL PRIMARY KEY,
    event_id             TEXT NOT NULL,
    event_name             TEXT NOT NULL,
    event_type               TEXT,
    start_date                  DATE NOT NULL,
    end_date                      DATE,
    expected_attendance             INTEGER,
    _source_file                      TEXT NOT NULL,
    _loaded_at                          TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                             TEXT[] NOT NULL DEFAULT '{}'
);

-- Source 6: weather, clean by design.
CREATE TABLE IF NOT EXISTS silver.weather_daily (
    weather_date     DATE PRIMARY KEY,
    temp_max_c          NUMERIC(5,1),
    temp_min_c            NUMERIC(5,1),
    dust_storm_flag         BOOLEAN NOT NULL DEFAULT false,
    rain_mm                   NUMERIC(6,2),
    _source_file                TEXT NOT NULL,
    _loaded_at                    TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                       TEXT[] NOT NULL DEFAULT '{}'
);

-- Source 7: membership and boarding contracts, one shape for gym,
-- equestrian club, and horse boarding.
CREATE TABLE IF NOT EXISTS silver.contracts (
    silver_contract_id   BIGSERIAL PRIMARY KEY,
    contract_id              TEXT NOT NULL,
    member_id                   TEXT NOT NULL,
    contract_type                  TEXT NOT NULL,     -- gym_monthly, gym_annual, equestrian_club, horse_boarding
    venue_id                          TEXT,
    start_date                           DATE NOT NULL,
    end_date                                DATE,          -- null: open-ended, churn inferred from status
    monthly_amount_kwd                        NUMERIC(12,3) NOT NULL,
    status                                       TEXT NOT NULL,    -- active, expired, cancelled
    cancellation_date                              DATE,
    stable_id                                        TEXT,
    _source_file                                       TEXT NOT NULL,
    _loaded_at                                           TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                                              TEXT[] NOT NULL DEFAULT '{}'
);

-- Source 8: lesson schedule and attendance, the capacity denominator.
CREATE TABLE IF NOT EXISTS silver.lesson_slots (
    silver_lesson_slot_id   BIGSERIAL PRIMARY KEY,
    lesson_id                   TEXT NOT NULL,
    lesson_date                    DATE NOT NULL,
    start_time                        TIME,
    instructor_id                       TEXT,
    level                                  TEXT,
    capacity                                 INTEGER NOT NULL,
    booked                                     INTEGER NOT NULL,
    attended                                     INTEGER,     -- nullable: sometimes not marked
    horse_ids                                      TEXT[],
    is_overbooked                                    BOOLEAN NOT NULL DEFAULT false,
    _source_file                                       TEXT NOT NULL,
    _loaded_at                                           TIMESTAMP NOT NULL DEFAULT now(),
    _dq_flags                                              TEXT[] NOT NULL DEFAULT '{}'
);
