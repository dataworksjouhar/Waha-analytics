-- Reporting views for the site plan: the spatial view of the park.
--
-- The map answers questions the tables cannot. Sales per square metre is
-- inherently spatial, and "a large unit trading weakly" is visible as a
-- shape before it is legible as a number. These two views exist because
-- the map needs one tidy source per thing it draws (units, gates) rather
-- than joining four exports together in the browser.

-- Everything the map needs to colour a tenant plot, at tenant x month.
-- This is a convenience join over the same current-version submissions
-- 02_tenants.sql already reports: sales, sales per sqm, rent owed and
-- submission behaviour side by side, so the map can switch fill metric
-- without switching data source.
--
-- unit_no is what ties a row here to a plot in the site plan config. It
-- is the join key between the warehouse and the drawing, which is why the
-- config references unit numbers rather than tenant names: a unit outlives
-- the tenant occupying it, and re-letting U-112 should not require
-- redrawing the map.
CREATE OR REPLACE VIEW gold.vw_tenant_site_metrics AS
SELECT
    t.tenant_key,
    t.tenant_id,
    t.tenant_name,
    t.category,
    t.unit_no,
    t.unit_sqm,
    t.status,
    ts.month_date_key,
    d.full_date AS month_start,
    COALESCE(ts.gross_sales_kwd, ts.net_sales_kwd) AS sales_kwd,
    COALESCE(ts.gross_sales_kwd, ts.net_sales_kwd) / NULLIF(t.unit_sqm, 0) AS sales_per_sqm_kwd,
    t.base_rent_kwd,
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
ORDER BY t.unit_no, d.full_date;

-- Gate x month x hour, averaged per day so months of different lengths
-- stay comparable. This is what makes the hour scrubber possible: the
-- evening-weighted curve and the Ramadan shift stop being a line on a
-- chart and become gates that visibly swell and shrink.
--
-- Grain matters here. gold.fact_footfall is gate x date x hour, roughly
-- 70k rows, far too much to ship to a browser as JSON. Rolling up to
-- gate x month x hour gives 4 x 24 x 24 = ~2,300 rows, which still
-- supports both the season filter and the scrubber. Choosing the
-- coarsest grain that answers the question is the whole aggregate-fact
-- argument, applied to a payload budget instead of a query cost.
CREATE OR REPLACE VIEW gold.vw_footfall_gate_hour_monthly AS
SELECT
    g.gate_key,
    g.gate_id,
    g.gate_name,
    md.date_key AS month_date_key,
    md.full_date AS month_start,
    f.hour,
    ROUND(AVG(f.count_in), 1) AS avg_count_in,
    SUM(f.count_in) AS total_count_in,
    COUNT(DISTINCT f.date_key) AS day_count,
    bool_or(f.is_imputed) AS has_imputed,
    bool_or(f.is_outlier_corrected) AS has_corrected
FROM gold.fact_footfall f
JOIN gold.dim_gate g ON g.gate_key = f.gate_key
JOIN gold.dim_date d ON d.date_key = f.date_key
JOIN gold.dim_date md ON md.full_date = date_trunc('month', d.full_date)::date
GROUP BY g.gate_key, g.gate_id, g.gate_name, md.date_key, md.full_date, f.hour
ORDER BY g.gate_id, md.full_date, f.hour;
