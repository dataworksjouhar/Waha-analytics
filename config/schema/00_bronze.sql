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
    status                TEXT NOT NULL DEFAULT 'landed', -- landed, processed, failed
    landed_at             TIMESTAMP NOT NULL DEFAULT now(),
    processed_at          TIMESTAMP,
    UNIQUE (source_name, file_name)
);

CREATE INDEX IF NOT EXISTS ix_file_registry_status
    ON bronze.file_registry (status);
