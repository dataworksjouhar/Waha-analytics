-- Data quality results. Every check the pipeline runs (row counts, key
-- uniqueness, referential integrity, value ranges, freshness) writes one
-- row here per execution, pass or fail. This is the audit trail that lets
-- "data quality is the point" be demonstrated rather than just claimed.

CREATE SCHEMA IF NOT EXISTS dq;

CREATE TABLE IF NOT EXISTS dq.check_results (
    check_result_id   BIGSERIAL PRIMARY KEY,
    run_id              UUID NOT NULL,                -- groups all checks from one pipeline run
    check_name           TEXT NOT NULL,                 -- e.g. tenant_sales_no_future_dates
    check_type            TEXT NOT NULL,                  -- row_count, uniqueness, referential_integrity, value_range, freshness
    schema_name           TEXT NOT NULL,                   -- silver / gold
    table_name             TEXT NOT NULL,
    status                  TEXT NOT NULL,                    -- pass, fail
    expected_value          TEXT,
    actual_value             TEXT,
    details                   TEXT,
    checked_at                 TIMESTAMP NOT NULL DEFAULT now()
);

-- Added for session 12 (pipeline/dq/checks.py). error-severity failures
-- (uniqueness, referential integrity: invariants the code should always
-- satisfy) gate the orchestrator; warning-severity failures (row_count,
-- value_range, freshness: things that can legitimately drift a little)
-- are surfaced in the run summary but never block it. ADD COLUMN IF NOT
-- EXISTS keeps this file re-runnable against a database where the table
-- already exists from session 7, the same idempotency deploy_schema.py's
-- docstring already promises for every other statement here.
ALTER TABLE dq.check_results ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'error';

CREATE INDEX IF NOT EXISTS ix_check_results_run_id ON dq.check_results (run_id);
CREATE INDEX IF NOT EXISTS ix_check_results_status ON dq.check_results (status);
