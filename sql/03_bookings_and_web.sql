-- Reporting views for metrics 5 and 6 (architecture doc section 9): online
-- vs walk-in ticket mix, website conversion rate by channel.

-- Metric 5: online (fact_bookings) vs walk-in (fact_pos_sales) by product.
-- Both facts reference the same gold.dim_product, so the mix is a direct
-- join on product_key rather than a name-matching heuristic.
CREATE OR REPLACE VIEW gold.vw_ticket_channel_mix AS
WITH online AS (
    SELECT
        p.product_key, p.product_code, p.product_name, p.category,
        SUM(b.qty) AS qty,
        SUM(b.amount_kwd) AS amount_kwd
    FROM gold.fact_bookings b
    JOIN gold.dim_product p ON p.product_key = b.product_key
    WHERE NOT b.is_cancelled
    GROUP BY p.product_key, p.product_code, p.product_name, p.category
),
walk_in AS (
    SELECT
        p.product_key, p.product_code, p.product_name, p.category,
        SUM(s.qty) AS qty,
        SUM(s.line_amount_kwd) AS amount_kwd
    FROM gold.fact_pos_sales s
    JOIN gold.dim_product p ON p.product_key = s.product_key
    WHERE NOT s.is_refund
    GROUP BY p.product_key, p.product_code, p.product_name, p.category
)
SELECT
    COALESCE(o.product_key, w.product_key)   AS product_key,
    COALESCE(o.product_code, w.product_code) AS product_code,
    COALESCE(o.product_name, w.product_name) AS product_name,
    COALESCE(o.category, w.category)         AS category,
    COALESCE(o.qty, 0)         AS online_qty,
    COALESCE(o.amount_kwd, 0)  AS online_amount_kwd,
    COALESCE(w.qty, 0)         AS walk_in_qty,
    COALESCE(w.amount_kwd, 0)  AS walk_in_amount_kwd,
    ROUND(100.0 * COALESCE(o.qty, 0) / NULLIF(COALESCE(o.qty, 0) + COALESCE(w.qty, 0), 0), 1) AS online_share_pct
FROM online o
FULL OUTER JOIN walk_in w ON w.product_key = o.product_key
ORDER BY product_name;

-- Metric 6: sessions vs bookings by channel. A small share of bookings
-- arrive with channel_key null (attribution loss, architecture doc
-- section 3); those are grouped under their own row rather than dropped,
-- since "how much revenue can't be attributed" is itself worth reporting.
CREATE OR REPLACE VIEW gold.vw_web_channel_conversion AS
WITH sessions AS (
    SELECT
        c.channel_key, c.channel_name,
        SUM(ws.sessions) AS sessions,
        SUM(ws.engaged_sessions) AS engaged_sessions,
        SUM(ws.users) AS users
    FROM gold.fact_web_sessions ws
    JOIN gold.dim_channel c ON c.channel_key = ws.channel_key
    GROUP BY c.channel_key, c.channel_name
),
bookings AS (
    SELECT
        b.channel_key,
        COUNT(*) FILTER (WHERE NOT b.is_cancelled) AS booking_count,
        SUM(b.amount_kwd) FILTER (WHERE NOT b.is_cancelled) AS booking_amount_kwd
    FROM gold.fact_bookings b
    GROUP BY b.channel_key
)
SELECT
    COALESCE(s.channel_key, b.channel_key) AS channel_key,
    COALESCE(s.channel_name, 'unknown (attribution loss)') AS channel_name,
    s.sessions,
    s.engaged_sessions,
    s.users,
    COALESCE(b.booking_count, 0) AS booking_count,
    COALESCE(b.booking_amount_kwd, 0) AS booking_amount_kwd,
    ROUND(100.0 * COALESCE(b.booking_count, 0) / NULLIF(s.sessions, 0), 2) AS conversion_rate_pct
FROM sessions s
FULL OUTER JOIN bookings b ON b.channel_key = s.channel_key
ORDER BY channel_name;
