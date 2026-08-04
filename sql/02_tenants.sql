-- Reporting views for metrics 3 and 4 (architecture doc section 9), plus
-- the tenant compliance view that supports metric 3. Current-version
-- submissions only throughout: fact_tenant_sales keeps every version, and
-- gold.vw_* views report the version that is true today, the same way
-- dim_tenant.is_current does for SCD Type 2.

-- Metric 3: turnover rent owed, computed from the lease terms in
-- dim_tenant against the current-version monthly submission. There is no
-- separate rent-collection/AR source in this project (architecture doc
-- section 3 lists nine sources, none of them payments), so this view
-- reports what is contractually owed rather than inventing a "collected"
-- figure with no backing source. A tenant-month with no current submission
-- simply has no row here; that gap is exactly what vw_tenant_compliance
-- below tracks.
CREATE OR REPLACE VIEW gold.vw_tenant_turnover_rent AS
SELECT
    t.tenant_key,
    t.tenant_id,
    t.tenant_name,
    t.category,
    ts.month_date_key,
    d.full_date AS month_start,
    t.base_rent_kwd,
    COALESCE(ts.gross_sales_kwd, ts.net_sales_kwd) AS reported_sales_kwd,
    t.turnover_threshold_kwd,
    t.turnover_rent_pct,
    GREATEST(COALESCE(ts.gross_sales_kwd, ts.net_sales_kwd) - t.turnover_threshold_kwd, 0)
        * t.turnover_rent_pct / 100 AS turnover_rent_kwd,
    t.base_rent_kwd + GREATEST(COALESCE(ts.gross_sales_kwd, ts.net_sales_kwd) - t.turnover_threshold_kwd, 0)
        * t.turnover_rent_pct / 100 AS total_rent_owed_kwd,
    ts.days_late,
    ts.is_restated
FROM gold.fact_tenant_sales ts
JOIN gold.dim_tenant t ON t.tenant_key = ts.tenant_key
JOIN gold.dim_date d ON d.date_key = ts.month_date_key
WHERE ts.is_current_version
ORDER BY t.tenant_name, d.full_date;

-- Metric 4: sales per square metre, row grain of tenant x month so the
-- frontend can roll up to category (or drill into one tenant) without a
-- second view.
CREATE OR REPLACE VIEW gold.vw_tenant_sales_per_sqm AS
SELECT
    t.tenant_key,
    t.tenant_id,
    t.tenant_name,
    t.category,
    t.unit_sqm,
    ts.month_date_key,
    d.full_date AS month_start,
    COALESCE(ts.gross_sales_kwd, ts.net_sales_kwd) AS sales_kwd,
    COALESCE(ts.gross_sales_kwd, ts.net_sales_kwd) / NULLIF(t.unit_sqm, 0) AS sales_per_sqm_kwd
FROM gold.fact_tenant_sales ts
JOIN gold.dim_tenant t ON t.tenant_key = ts.tenant_key
JOIN gold.dim_date d ON d.date_key = ts.month_date_key
WHERE ts.is_current_version
ORDER BY t.category, t.tenant_name, d.full_date;

-- Supporting view for metric 3: submission compliance by tenant. This is
-- the showcase mess (architecture doc section 3, source 3) made
-- measurable, days late and restatement rate rather than a shrug.
CREATE OR REPLACE VIEW gold.vw_tenant_compliance AS
SELECT
    t.tenant_key,
    t.tenant_id,
    t.tenant_name,
    t.category,
    COUNT(*) AS submission_count,
    AVG(ts.days_late) AS avg_days_late,
    MAX(ts.days_late) AS max_days_late,
    COUNT(*) FILTER (WHERE ts.is_restated) AS restated_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE ts.is_restated) / NULLIF(COUNT(*), 0), 1) AS restated_pct
FROM gold.fact_tenant_sales ts
JOIN gold.dim_tenant t ON t.tenant_key = ts.tenant_key
WHERE ts.is_current_version
GROUP BY t.tenant_key, t.tenant_id, t.tenant_name, t.category
ORDER BY avg_days_late DESC;
