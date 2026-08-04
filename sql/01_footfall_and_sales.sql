-- Reporting views for metrics 1, 2, 7, 10 (architecture doc section 9):
-- daily footfall vs week/year ago with weather, footfall-to-sales
-- conversion, event ROI vs a trailing baseline, average transaction value.
-- All CREATE OR REPLACE, safe to re-run, plain ANSI SQL reading only from
-- the gold schema.

-- Metric 1: daily footfall, week-ago and year-ago comparison, weather
-- overlay. Imputed and outlier-corrected hours are never hidden: a day
-- built from any such hour is flagged, not silently presented as raw.
CREATE OR REPLACE VIEW gold.vw_footfall_daily AS
WITH daily AS (
    SELECT
        f.date_key,
        d.full_date,
        d.season,
        d.is_weekend,
        d.is_ramadan,
        SUM(f.count_in)      AS footfall,
        bool_or(f.is_imputed)           AS has_imputed_hours,
        bool_or(f.is_outlier_corrected) AS has_corrected_hours
    FROM gold.fact_footfall f
    JOIN gold.dim_date d ON d.date_key = f.date_key
    GROUP BY f.date_key, d.full_date, d.season, d.is_weekend, d.is_ramadan
)
SELECT
    cur.date_key,
    cur.full_date,
    cur.season,
    cur.is_weekend,
    cur.is_ramadan,
    cur.footfall,
    cur.has_imputed_hours,
    cur.has_corrected_hours,
    wk.footfall AS footfall_week_ago,
    yr.footfall AS footfall_year_ago,
    w.temp_max_c,
    w.temp_min_c,
    w.dust_storm_flag,
    w.rain_mm
FROM daily cur
LEFT JOIN daily wk ON wk.full_date = cur.full_date - 7
LEFT JOIN daily yr ON yr.full_date = (cur.full_date - INTERVAL '1 year')::date
LEFT JOIN gold.dim_date_weather w ON w.date_key = cur.date_key
ORDER BY cur.full_date;

-- Footfall by entrance, date x zone grain. The counter vendor gives four
-- physical sensors but the site has two entrances, so this rolls the
-- sensors up to the thing a GM actually asks about. Reading it next to
-- vw_footfall_daily is how "the Equestrian Gate held up through summer
-- while the west strip collapsed" becomes visible, which is the whole
-- point of the divergent seasonality curves in the config.
CREATE OR REPLACE VIEW gold.vw_footfall_by_zone AS
SELECT
    f.date_key,
    d.full_date,
    d.season,
    d.is_weekend,
    d.is_ramadan,
    g.zone,
    g.gate_label,
    g.primary_venue_served,
    SUM(f.count_in) AS footfall,
    bool_or(f.is_imputed)           AS has_imputed_hours,
    bool_or(f.is_outlier_corrected) AS has_corrected_hours
FROM gold.fact_footfall f
JOIN gold.dim_gate g ON g.gate_key = f.gate_key
JOIN gold.dim_date d ON d.date_key = f.date_key
GROUP BY f.date_key, d.full_date, d.season, d.is_weekend, d.is_ramadan,
         g.zone, g.gate_label, g.primary_venue_served
ORDER BY d.full_date, g.zone;

-- Metric 2: site-wide footfall against each own venue's revenue, the
-- park-to-venue conversion the GM cannot currently see.
--
-- The headline denominator is deliberately SITE-WIDE, not per venue. One
-- visitor entering the Main Gate may walk the tenant strip, then the Farm,
-- then the gym on a single entry, so gate-to-venue is many to many and
-- there is no honest way to say a given entry "belongs" to The Farm.
-- Dividing venue revenue by the traffic that could plausibly have reached
-- it is the defensible ratio, and it is what revenue_per_visitor_kwd is.
--
-- entrance_footfall is offered alongside it as the narrower denominator:
-- the traffic through the entrance most of this venue's visitors actually
-- use, via dim_venue.gate_proximity matching dim_gate.gate_label. It is a
-- genuinely better figure for the Equestrian Centre, which has its own
-- entrance and is the only venue in its zone. It is a WORSE figure for the
-- Playground, Farm and gym, which all share the Main Gate and so all get
-- the same denominator, none of which is really theirs. Both are exposed,
-- named for what they are, so the dashboard can pick per venue rather than
-- one being silently substituted for the other.
CREATE OR REPLACE VIEW gold.vw_footfall_sales_conversion AS
WITH daily_footfall AS (
    SELECT date_key, SUM(count_in) AS footfall
    FROM gold.fact_footfall
    GROUP BY date_key
),
entrance_footfall AS (
    SELECT f.date_key, g.gate_label, SUM(f.count_in) AS footfall
    FROM gold.fact_footfall f
    JOIN gold.dim_gate g ON g.gate_key = f.gate_key
    GROUP BY f.date_key, g.gate_label
),
daily_sales AS (
    SELECT
        date_key,
        venue_key,
        SUM(line_amount_kwd) AS revenue_kwd,
        COUNT(*) FILTER (WHERE NOT is_refund) AS line_count
    FROM gold.fact_pos_sales
    GROUP BY date_key, venue_key
)
-- The five new columns are appended at the END of this list rather than
-- sitting next to the figures they relate to, which would read better.
-- Postgres CREATE OR REPLACE VIEW can only add columns after the existing
-- ones: it refuses any change to the name or position of a column that is
-- already there, because something downstream may be selecting by
-- position. Appending is what keeps this file re-runnable against a live
-- warehouse instead of needing a DROP VIEW, which would in turn break
-- anything built on top of it.
SELECT
    s.date_key,
    dd.full_date,
    v.venue_id,
    v.venue_name,
    v.venue_type,
    f.footfall,
    s.revenue_kwd,
    s.line_count,
    CASE WHEN f.footfall > 0 THEN s.revenue_kwd / f.footfall END AS revenue_per_visitor_kwd,
    CASE WHEN f.footfall > 0 THEN s.line_count::numeric / f.footfall END AS conversion_rate,
    v.zone,
    v.gate_proximity,
    ef.footfall AS entrance_footfall,
    CASE WHEN ef.footfall > 0 THEN s.revenue_kwd / ef.footfall END AS revenue_per_entrance_visitor_kwd,
    CASE WHEN ef.footfall > 0 THEN s.line_count::numeric / ef.footfall END AS entrance_conversion_rate
FROM daily_sales s
JOIN gold.dim_venue v ON v.venue_key = s.venue_key
JOIN daily_footfall f ON f.date_key = s.date_key
-- LEFT, not inner: a venue whose gate_proximity has no matching gate_label
-- should lose its entrance figure, not vanish from metric 2 entirely.
LEFT JOIN entrance_footfall ef ON ef.date_key = s.date_key AND ef.gate_label = v.gate_proximity
JOIN gold.dim_date dd ON dd.date_key = s.date_key
ORDER BY dd.full_date, v.venue_name;

-- Metric 7: event ROI. Baseline is the trailing 14 days before each event's
-- start, excluding any day that itself falls inside another event's window
-- so overlapping events don't pollute each other's baseline. An event with
-- end_date before start_date (the planted DQ catch, architecture doc
-- section 3) simply produces zero event days here via the BETWEEN join,
-- rather than erroring; the malformed row itself is dq's job to flag.
CREATE OR REPLACE VIEW gold.vw_event_roi AS
WITH event_days AS (
    SELECT e.event_key, d.date_key, d.full_date
    FROM gold.dim_event e
    JOIN gold.dim_date d ON d.full_date BETWEEN e.start_date AND COALESCE(e.end_date, e.start_date)
),
daily_footfall AS (
    SELECT date_key, SUM(count_in) AS footfall FROM gold.fact_footfall GROUP BY date_key
),
daily_sales AS (
    SELECT date_key, SUM(line_amount_kwd) AS sales_kwd
    FROM gold.fact_pos_sales WHERE NOT is_refund GROUP BY date_key
),
event_totals AS (
    SELECT
        ed.event_key,
        COUNT(DISTINCT ed.date_key) AS event_day_count,
        SUM(f.footfall)  AS total_footfall,
        SUM(s.sales_kwd) AS total_sales_kwd
    FROM event_days ed
    LEFT JOIN daily_footfall f ON f.date_key = ed.date_key
    LEFT JOIN daily_sales s ON s.date_key = ed.date_key
    GROUP BY ed.event_key
),
baseline AS (
    SELECT
        e.event_key,
        AVG(f.footfall)  AS baseline_avg_footfall,
        AVG(s.sales_kwd) AS baseline_avg_sales_kwd
    FROM gold.dim_event e
    JOIN gold.dim_date d ON d.full_date BETWEEN e.start_date - 14 AND e.start_date - 1
    LEFT JOIN daily_footfall f ON f.date_key = d.date_key
    LEFT JOIN daily_sales s ON s.date_key = d.date_key
    WHERE NOT EXISTS (
        SELECT 1 FROM gold.dim_event e2
        WHERE d.full_date BETWEEN e2.start_date AND COALESCE(e2.end_date, e2.start_date)
    )
    GROUP BY e.event_key
)
SELECT
    e.event_key,
    e.event_id,
    e.event_name,
    e.event_type,
    e.start_date,
    e.end_date,
    e.expected_attendance,
    t.event_day_count,
    t.total_footfall,
    t.total_sales_kwd,
    b.baseline_avg_footfall,
    b.baseline_avg_sales_kwd,
    (t.total_footfall::numeric / NULLIF(t.event_day_count, 0)) - b.baseline_avg_footfall AS footfall_uplift_per_day,
    (t.total_sales_kwd / NULLIF(t.event_day_count, 0)) - b.baseline_avg_sales_kwd AS sales_uplift_per_day_kwd
FROM gold.dim_event e
LEFT JOIN event_totals t ON t.event_key = e.event_key
LEFT JOIN baseline b ON b.event_key = e.event_key
ORDER BY e.start_date;

-- Metric 10: average transaction (invoice) value by venue. Refund invoices
-- are never dropped, just excluded from the average-of-genuine-purchases
-- figure and reported separately, so a venue with many refunds is visible
-- as such rather than quietly dragging the average down.
CREATE OR REPLACE VIEW gold.vw_avg_transaction_value AS
WITH invoice_totals AS (
    SELECT invoice_id, venue_key, SUM(line_amount_kwd) AS invoice_amount_kwd
    FROM gold.fact_pos_sales
    GROUP BY invoice_id, venue_key
)
SELECT
    v.venue_key,
    v.venue_id,
    v.venue_name,
    v.venue_type,
    COUNT(*) FILTER (WHERE t.invoice_amount_kwd > 0) AS sale_invoice_count,
    COUNT(*) FILTER (WHERE t.invoice_amount_kwd < 0) AS refund_invoice_count,
    AVG(t.invoice_amount_kwd) FILTER (WHERE t.invoice_amount_kwd > 0) AS avg_transaction_value_kwd,
    SUM(t.invoice_amount_kwd) AS net_revenue_kwd
FROM invoice_totals t
JOIN gold.dim_venue v ON v.venue_key = t.venue_key
GROUP BY v.venue_key, v.venue_id, v.venue_name, v.venue_type
ORDER BY v.venue_name;
