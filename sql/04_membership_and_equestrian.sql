-- Reporting views for metrics 8, 9, 11, 12 (architecture doc section 9):
-- membership active base and churn, the revenue mix across all three
-- income streams, riding lesson utilization, stable occupancy.

-- Metric 8: active base, new/churned counts and MRR by month and contract
-- type. Churn rate is churned this month over active last month, computed
-- in a second pass over the monthly CTE rather than nesting a window
-- function inside an aggregate.
CREATE OR REPLACE VIEW gold.vw_membership_active_churn AS
WITH monthly AS (
    SELECT
        fm.month_date_key,
        d.full_date AS month_start,
        fm.contract_type,
        COUNT(*) FILTER (WHERE fm.status = 'active') AS active_count,
        COUNT(*) FILTER (WHERE fm.is_new) AS new_count,
        COUNT(*) FILTER (WHERE fm.is_churned) AS churned_count,
        SUM(fm.mrr_kwd) FILTER (WHERE fm.status = 'active') AS active_mrr_kwd
    FROM gold.fact_membership_months fm
    JOIN gold.dim_date d ON d.date_key = fm.month_date_key
    GROUP BY fm.month_date_key, d.full_date, fm.contract_type
)
SELECT
    month_date_key,
    month_start,
    contract_type,
    active_count,
    new_count,
    churned_count,
    active_mrr_kwd,
    ROUND(100.0 * churned_count / NULLIF(
        LAG(active_count) OVER (PARTITION BY contract_type ORDER BY month_start), 0), 2) AS churn_rate_pct
FROM monthly
ORDER BY contract_type, month_start;

-- Metric 9: own-venue POS revenue, tenant rental income (base plus
-- turnover), and membership/boarding MRR, by month. The three streams
-- never overlap: memberships and boarding are periodic-snapshot contracts
-- in fact_membership_months, never invoice lines in fact_pos_sales, so
-- summing all three is not double counting.
CREATE OR REPLACE VIEW gold.vw_revenue_summary AS
WITH pos_monthly AS (
    SELECT md.date_key AS month_date_key, SUM(s.line_amount_kwd) AS own_venue_revenue_kwd
    FROM gold.fact_pos_sales s
    JOIN gold.dim_date d ON d.date_key = s.date_key
    JOIN gold.dim_date md ON md.full_date = date_trunc('month', d.full_date)::date
    WHERE NOT s.is_refund
    GROUP BY md.date_key
),
rental_monthly AS (
    SELECT
        ts.month_date_key,
        SUM(t.base_rent_kwd + GREATEST(COALESCE(ts.gross_sales_kwd, ts.net_sales_kwd) - t.turnover_threshold_kwd, 0)
            * t.turnover_rent_pct / 100) AS rental_revenue_kwd
    FROM gold.fact_tenant_sales ts
    JOIN gold.dim_tenant t ON t.tenant_key = ts.tenant_key
    WHERE ts.is_current_version
    GROUP BY ts.month_date_key
),
membership_monthly AS (
    SELECT month_date_key, SUM(mrr_kwd) FILTER (WHERE status = 'active') AS membership_mrr_kwd
    FROM gold.fact_membership_months
    GROUP BY month_date_key
),
months AS (
    SELECT month_date_key FROM pos_monthly
    UNION SELECT month_date_key FROM rental_monthly
    UNION SELECT month_date_key FROM membership_monthly
)
SELECT
    d.date_key AS month_date_key,
    d.full_date AS month_start,
    COALESCE(p.own_venue_revenue_kwd, 0) AS own_venue_revenue_kwd,
    COALESCE(r.rental_revenue_kwd, 0)    AS rental_revenue_kwd,
    COALESCE(m.membership_mrr_kwd, 0)    AS membership_mrr_kwd,
    COALESCE(p.own_venue_revenue_kwd, 0) + COALESCE(r.rental_revenue_kwd, 0)
        + COALESCE(m.membership_mrr_kwd, 0) AS total_revenue_kwd
FROM gold.dim_date d
JOIN months ON months.month_date_key = d.date_key
LEFT JOIN pos_monthly p ON p.month_date_key = d.date_key
LEFT JOIN rental_monthly r ON r.month_date_key = d.date_key
LEFT JOIN membership_monthly m ON m.month_date_key = d.date_key
ORDER BY d.full_date;

-- Metric 11: booked/capacity utilization and no-show rate by level and
-- instructor. missing_attendance_count is carried through rather than
-- hidden: a coach who forgot to mark attendance understates attended
-- (SUM ignores nulls), which would overstate the no-show rate if read
-- without that caveat visible alongside it.
CREATE OR REPLACE VIEW gold.vw_lesson_utilization AS
SELECT
    ls.level,
    i.instructor_key,
    i.instructor_name,
    COUNT(*) AS lesson_count,
    SUM(ls.capacity) AS total_capacity,
    SUM(ls.booked)   AS total_booked,
    SUM(ls.attended) AS total_attended,
    COUNT(*) FILTER (WHERE ls.attended IS NULL) AS missing_attendance_count,
    COUNT(*) FILTER (WHERE ls.is_overbooked) AS overbooked_count,
    ROUND(100.0 * SUM(ls.booked) / NULLIF(SUM(ls.capacity), 0), 1) AS utilization_pct,
    ROUND(100.0 * (SUM(ls.booked) - SUM(ls.attended)) / NULLIF(SUM(ls.booked), 0), 1) AS no_show_rate_pct
FROM gold.fact_lesson_slots ls
LEFT JOIN gold.dim_instructor i ON i.instructor_key = ls.instructor_key
GROUP BY ls.level, i.instructor_key, i.instructor_name
ORDER BY ls.level, i.instructor_name;

-- Metric 11 by month, added in session 7's successor for the same reason
-- the web conversion view gained one: the whole-history figure above says
-- beginner runs at 91% and advanced at 48%, which reads as a mild
-- imbalance worth noting. It is not mild. Averaging the year flattens a
-- summer trough into a winter peak, and the peak is where the decision
-- lives: from October to March beginner sits at 99 to 100 percent of
-- capacity (turning demand away, and overbooking when it cannot) while
-- advanced never clears 55 in any month of the two years.
--
-- Both grains are kept. The aggregate is the right answer to "what did
-- this level run at over two years"; only the monthly rows can show that
-- the gap holds at every point of the season, which is what separates a
-- scheduling problem from a seasonal one.
--
-- instructor_key is carried even though it adds no information in this
-- client's data (each level has exactly one instructor, so the two
-- columns are collinear and a per-instructor reading is really a
-- per-level reading wearing a name). It stays because a riding school
-- where instructors cover several levels is the normal case, and this
-- view should not need rewriting for that client. The frontend rolls up
-- to level and says why.
CREATE OR REPLACE VIEW gold.vw_lesson_utilization_monthly AS
SELECT
    d.year * 100 + d.month AS month_key,
    MIN(d.full_date) AS month_start,
    ls.level,
    i.instructor_key,
    i.instructor_name,
    COUNT(*) AS lesson_count,
    SUM(ls.capacity) AS total_capacity,
    SUM(ls.booked)   AS total_booked,
    SUM(ls.attended) AS total_attended,
    COUNT(*) FILTER (WHERE ls.attended IS NULL) AS missing_attendance_count,
    COUNT(*) FILTER (WHERE ls.is_overbooked) AS overbooked_count,
    ROUND(100.0 * SUM(ls.booked) / NULLIF(SUM(ls.capacity), 0), 1) AS utilization_pct,
    -- Slots where the coach never marked attendance are excluded from the
    -- no-show denominator rather than counted as full attendance. A
    -- missing mark is not evidence that everybody turned up, and the
    -- count of those slots is carried alongside so the gap is visible.
    ROUND(100.0 * (SUM(ls.booked) FILTER (WHERE ls.attended IS NOT NULL) - SUM(ls.attended))
        / NULLIF(SUM(ls.booked) FILTER (WHERE ls.attended IS NOT NULL), 0), 1) AS no_show_rate_pct
FROM gold.fact_lesson_slots ls
JOIN gold.dim_date d ON d.date_key = ls.date_key
LEFT JOIN gold.dim_instructor i ON i.instructor_key = ls.instructor_key
GROUP BY d.year * 100 + d.month, ls.level, i.instructor_key, i.instructor_name
ORDER BY month_key, ls.level;

-- Supporting view for metric 11: instructors on the roster who taught no
-- lessons at all in the period.
--
-- This exists because the utilization view is an inner reading of the
-- fact: an instructor with no slots simply has no row, and a dashboard
-- built only on that view would show a full roster with everyone busy.
-- Al Waha employs four instructors and the schedule only ever assigns
-- three. Whether that is a data gap or a real one (someone on long-term
-- leave, someone hired and never rostered) is a question for the client,
-- and the point of the pipeline is to raise it rather than to let a
-- LEFT JOIN quietly hide it.
CREATE OR REPLACE VIEW gold.vw_instructor_coverage AS
SELECT
    i.instructor_key,
    i.instructor_id,
    i.instructor_name,
    i.specialty_level,
    i.status,
    i.hire_date,
    COALESCE(COUNT(ls.lesson_slot_key), 0) AS lesson_count,
    COALESCE(SUM(ls.capacity), 0) AS total_capacity,
    COALESCE(SUM(ls.booked), 0) AS total_booked
FROM gold.dim_instructor i
LEFT JOIN gold.fact_lesson_slots ls ON ls.instructor_key = i.instructor_key
GROUP BY i.instructor_key, i.instructor_id, i.instructor_name, i.specialty_level,
         i.status, i.hire_date
ORDER BY lesson_count DESC, i.instructor_name;

-- Metric 12: occupied boxes vs total stable inventory, plus boarding MRR,
-- by month. Occupancy counts distinct stables under an active boarding
-- contract that month against the fixed denominator in dim_stable.
CREATE OR REPLACE VIEW gold.vw_stable_occupancy AS
WITH boarding_by_month AS (
    SELECT month_date_key, stable_key, mrr_kwd
    FROM gold.fact_membership_months
    WHERE contract_type = 'horse_boarding' AND status = 'active'
),
total_stables AS (
    SELECT COUNT(*) AS total_boxes FROM gold.dim_stable
)
SELECT
    b.month_date_key,
    d.full_date AS month_start,
    COUNT(DISTINCT b.stable_key) AS occupied_boxes,
    ts.total_boxes,
    ROUND(100.0 * COUNT(DISTINCT b.stable_key) / NULLIF(ts.total_boxes, 0), 1) AS occupancy_pct,
    SUM(b.mrr_kwd) AS boarding_revenue_kwd
FROM boarding_by_month b
JOIN gold.dim_date d ON d.date_key = b.month_date_key
CROSS JOIN total_stables ts
GROUP BY b.month_date_key, d.full_date, ts.total_boxes
ORDER BY d.full_date;
