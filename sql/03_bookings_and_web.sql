-- Reporting views for metrics 5 and 6 (architecture doc section 9): online
-- vs walk-in ticket mix, website conversion rate by channel.

-- Metric 5: online (fact_bookings) vs walk-in (fact_pos_sales) by product.
-- Both facts reference the same gold.dim_product, so the mix is a direct
-- join on product_key rather than a name-matching heuristic.
--
-- venue_key and venue_name are carried (added in session 7) because the
-- SKU grain cannot answer metric 5 on its own. The booking website sells
-- one ticket per venue while the till sells adult, child and family, and
-- pipeline/load/fact_bookings.py crosswalks every online ticket onto the
-- adult SKU. Read per SKU that makes child tickets look like a product
-- nobody buys online and adult tickets look more online than they are.
-- Neither is true: the website simply has no child SKU. Venue plus
-- category is the grain where the two channels are actually comparable,
-- and it comes off the dimension rather than a hardcoded list, so a
-- client whose SKU tree differs needs no code change.
CREATE OR REPLACE VIEW gold.vw_ticket_channel_mix AS
WITH online AS (
    SELECT
        p.product_key, p.product_code, p.product_name, p.category, p.venue_key,
        SUM(b.qty) AS qty,
        SUM(b.amount_kwd) AS amount_kwd
    FROM gold.fact_bookings b
    JOIN gold.dim_product p ON p.product_key = b.product_key
    WHERE NOT b.is_cancelled
    GROUP BY p.product_key, p.product_code, p.product_name, p.category, p.venue_key
),
walk_in AS (
    SELECT
        p.product_key, p.product_code, p.product_name, p.category, p.venue_key,
        SUM(s.qty) AS qty,
        SUM(s.line_amount_kwd) AS amount_kwd
    FROM gold.fact_pos_sales s
    JOIN gold.dim_product p ON p.product_key = s.product_key
    WHERE NOT s.is_refund
    GROUP BY p.product_key, p.product_code, p.product_name, p.category, p.venue_key
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
    ROUND(100.0 * COALESCE(o.qty, 0) / NULLIF(COALESCE(o.qty, 0) + COALESCE(w.qty, 0), 0), 1) AS online_share_pct,
    -- Appended rather than sitting next to category where they belong
    -- logically. CREATE OR REPLACE VIEW can only add columns at the end:
    -- inserting one mid-list is read as renaming every column after it and
    -- Postgres refuses. Keeping the file re-runnable is worth more than
    -- tidy column order, since the alternative is a DROP that would
    -- cascade into anything built on top of this view.
    COALESCE(o.venue_key, w.venue_key)       AS venue_key,
    -- Event tickets hang off no venue: a bazaar is a site-wide event, not
    -- something the Playground sells. Labelled rather than left null so
    -- the rollup has a bucket to put them in.
    COALESCE(v.venue_name, 'Site-wide')      AS venue_name
FROM online o
FULL OUTER JOIN walk_in w ON w.product_key = o.product_key
LEFT JOIN gold.dim_venue v ON v.venue_key = COALESCE(o.venue_key, w.venue_key)
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

-- Metric 6 at a monthly grain, added in session 7.
--
-- The whole-history view above answers "which channel converts best" and
-- cannot answer "which channel is getting worse", because a single
-- averaged rate per channel has had the time dimension summed out of it.
-- Those are different questions and the second one is the one that costs
-- money: a channel whose conversion is decaying while its session share
-- holds steady looks healthy on every volume report anyone runs, and the
-- media budget keeps renewing.
--
-- Both views are kept. The aggregate is the correct denominator for "what
-- did this channel deliver over two years", and re-deriving it by summing
-- the monthly rows would invite someone to average the twenty-four
-- monthly percentages, which is not the same number: a mean of ratios
-- weights a quiet August equally with a busy January. Same data, two
-- grains, each honest about what it answers.
CREATE OR REPLACE VIEW gold.vw_web_channel_conversion_monthly AS
WITH sessions AS (
    SELECT
        d.year * 100 + d.month AS month_key,
        MIN(d.full_date) AS month_start,
        c.channel_key,
        c.channel_name,
        SUM(ws.sessions) AS sessions,
        SUM(ws.engaged_sessions) AS engaged_sessions,
        SUM(ws.users) AS users
    FROM gold.fact_web_sessions ws
    JOIN gold.dim_date d ON d.date_key = ws.date_key
    JOIN gold.dim_channel c ON c.channel_key = ws.channel_key
    GROUP BY d.year * 100 + d.month, c.channel_key, c.channel_name
),
bookings AS (
    SELECT
        d.year * 100 + d.month AS month_key,
        b.channel_key,
        COUNT(*) FILTER (WHERE NOT b.is_cancelled) AS booking_count,
        SUM(b.amount_kwd) FILTER (WHERE NOT b.is_cancelled) AS booking_amount_kwd
    FROM gold.fact_bookings b
    JOIN gold.dim_date d ON d.date_key = b.date_key
    GROUP BY d.year * 100 + d.month, b.channel_key
)
SELECT
    COALESCE(s.month_key, b.month_key) AS month_key,
    s.month_start,
    COALESCE(s.channel_key, b.channel_key) AS channel_key,
    -- Bookings whose channel was lost in attribution have a null
    -- channel_key, which never equals a sessions row, so they arrive here
    -- as booking-only rows and are labelled rather than dropped. Their
    -- conversion rate is null, not zero: there is no session count to
    -- divide by, and printing 0% would read as a channel that fails to
    -- convert instead of one we cannot measure.
    COALESCE(s.channel_name, 'unknown (attribution loss)') AS channel_name,
    s.sessions,
    s.engaged_sessions,
    s.users,
    COALESCE(b.booking_count, 0) AS booking_count,
    COALESCE(b.booking_amount_kwd, 0) AS booking_amount_kwd,
    ROUND(100.0 * COALESCE(b.booking_count, 0) / NULLIF(s.sessions, 0), 2) AS conversion_rate_pct
FROM sessions s
FULL OUTER JOIN bookings b
    ON b.channel_key = s.channel_key
   AND b.month_key = s.month_key
ORDER BY month_key, channel_name;
