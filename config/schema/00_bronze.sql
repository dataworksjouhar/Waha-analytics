-- Bronze layer: raw files land on disk under data/bronze/<source>/<load_date>/
-- and are never edited. This schema holds only a registry of what has
-- landed, so extract/load jobs know what exists and whether it has been
-- processed, without re-reading the whole data/bronze/ tree every run.

CREATE SCHEMA IF NOT EXISTS bronze;

CREATE TABLE IF NOT EXISTS bronze.file_registry (
    file_registry_id   BIGSERIAL PRIMARY KEY,
    source_name         TEXT NOT NULL,               -- pos_sales, footfall, tenant_sales, ...
    file_name           TEXT NOT NULL,
    file_path           TEXT NOT NULL,
    load_date            DATE NOT NULL,                -- date the file landed, not the data date
    row_count            INTEGER,
    checksum              TEXT NOT NULL,                  -- md5 of file contents; unchanged content is skipped on re-run
    status                TEXT NOT NULL DEFAULT 'landed', -- landed, processed, failed
    landed_at             TIMESTAMP NOT NULL DEFAULT now(),
    processed_at          TIMESTAMP,
    UNIQUE (source_name, file_name)
);

CREATE INDEX IF NOT EXISTS ix_file_registry_status
    ON bronze.file_registry (status);

-- ---------------------------------------------------------------------
-- Raw staging tables, one per source. Every column is TEXT: bronze
-- preserves exactly what landed, with no type coercion or cleaning
-- (that's silver's job in sessions 8-9). Lineage columns let any row be
-- traced back to the file it came from.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bronze.pos_sales_raw (
    invoiceid TEXT, salesid TEXT, invoicedate TEXT, itemid TEXT, itemname TEXT,
    qty TEXT, salesprice TEXT, lineamount TEXT, currencycode TEXT,
    inventsiteid TEXT, inventlocationid TEXT, custaccount TEXT, paymentmode TEXT,
    createddatetime TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.footfall_raw (
    sensor_id TEXT, gate_name TEXT, date TEXT, hour TEXT, count_in TEXT, count_out TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

-- date/gross_sales/net_sales are kept as raw text since format and which
-- columns are present both vary by tenant. tenant_id/month/is_restatement
-- come from parsing the filename convention, not from cell values, so
-- that's cataloging, not a transformation of the data itself.
CREATE TABLE IF NOT EXISTS bronze.tenant_sales_raw (
    tenant_id TEXT, sales_month TEXT, is_restatement BOOLEAN,
    date_raw TEXT, gross_sales_raw TEXT, net_sales_raw TEXT,
    submitted_date DATE,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.web_sessions_raw (
    date TEXT, channel TEXT, device TEXT, sessions TEXT, engaged_sessions TEXT, users TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.web_bookings_raw (
    booking_id TEXT, booking_datetime TEXT, product_code TEXT, qty TEXT,
    amount_kwd TEXT, channel TEXT, customer_id TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.events_raw (
    event_id TEXT, event_name TEXT, event_type TEXT, start_date TEXT, end_date TEXT,
    expected_attendance TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.weather_raw (
    date TEXT, temp_max_c TEXT, temp_min_c TEXT, dust_storm_flag TEXT, rain_mm TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.contracts_raw (
    contract_id TEXT, member_id TEXT, contract_type TEXT, venue_id TEXT,
    start_date TEXT, end_date TEXT, monthly_amount_kwd TEXT, status TEXT,
    cancellation_date TEXT, stable_id TEXT, phone_number TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.lessons_raw (
    lesson_id TEXT, lesson_date TEXT, start_time TEXT, instructor_id TEXT, level TEXT,
    capacity TEXT, booked TEXT, attended TEXT, horse_ids TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Master data (Source 9): static reference files, one raw table per seed.
CREATE TABLE IF NOT EXISTS bronze.master_venues_raw (
    venue_id TEXT, venue_name TEXT, venue_type TEXT, opened_date TEXT, description TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.master_gates_raw (
    gate_id TEXT, gate_name TEXT, description TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.master_products_raw (
    product_id TEXT, product_code TEXT, product_name TEXT, venue_id TEXT, category TEXT,
    unit_price_kwd TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.master_tenants_raw (
    tenant_id TEXT, tenant_name TEXT, category TEXT, unit_no TEXT, unit_sqm TEXT,
    lease_start TEXT, lease_end TEXT, base_rent_kwd TEXT, turnover_rent_pct TEXT,
    turnover_threshold_kwd TEXT, status TEXT, effective_start_date TEXT, effective_end_date TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.master_stables_raw (
    stable_id TEXT, box_no TEXT, size_category TEXT, status TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.master_instructors_raw (
    instructor_id TEXT, instructor_name TEXT, specialty_level TEXT, hire_date TEXT, status TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bronze.master_horses_raw (
    horse_id TEXT, horse_name TEXT, breed TEXT, level_suitability TEXT, stable_id TEXT,
    _source_file TEXT NOT NULL, _loaded_at TIMESTAMP NOT NULL DEFAULT now()
);
