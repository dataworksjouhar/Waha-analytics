"""Data quality checks module: runs a fixed battery of checks against
silver and gold, one row per check written to dq.check_results every run.
That table is append-only, never truncated the way silver/gold are -
it's the audit trail that lets "data quality is the point" (CLAUDE.md) be
demonstrated with evidence rather than just claimed.

Five check types, matching config/schema/03_dq.sql's comment:
row_count, uniqueness, referential_integrity, value_range, freshness.

Two severities, not five - matching what the pipeline orchestrator (session
12's pipeline/run.py) actually needs to decide, which is just "does this
stop the run or not":
- error: an invariant the code should always satisfy if it's working
  correctly (uniqueness, referential integrity). A failure here means real
  corruption, not normal data variance, so run.py gates on it.
- warning: something that can legitimately drift a little (row_count,
  value_range, freshness) without meaning anything is broken - e.g. the 5
  POS refunds and 14 booking cancellations dropped at the date window's
  edge (see docs/phase1-runbook.md notes for later) make the row_count
  checks tolerance-based rather than exact-match for exactly that reason.

Every referential_integrity check here is, strictly, redundant with a live
FK constraint already declared in config/schema/02_gold.sql - Postgres
would refuse the load before a bad row ever landed. They're kept anyway,
for two reasons: they're the honest place to demonstrate the check, and
they are exactly the check that would have caught this session's actual
bugs (a null date_key, a mismatched dtype) before they turned into a
crashed COPY - the fact they always pass today is the constraint working,
not the check being pointless.

    python -m pipeline.dq.checks
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, asdict

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine, with_retries
from pipeline.util import load_config


@dataclass
class CheckResult:
    check_name: str
    check_type: str
    schema_name: str
    table_name: str
    status: str  # pass, fail
    expected_value: str | None = None
    actual_value: str | None = None
    details: str | None = None


CHECK_TYPE_SEVERITY = {
    "uniqueness": "error",
    "referential_integrity": "error",
    "row_count": "warning",
    "value_range": "warning",
    "freshness": "warning",
}


def _scalar(conn, sql: str):
    return conn.execute(sqlalchemy.text(sql)).scalar()


# ---------------------------------------------------------------------
# row_count: gold fact vs. its silver source, tolerance-based rather than
# exact-match wherever a documented boundary drop applies.
# ---------------------------------------------------------------------
ROW_COUNT_PAIRS = [
    # (check_name, silver_count_sql, gold_table, min_ratio)
    ("fact_pos_sales_vs_silver",
     "SELECT COUNT(*) FROM silver.pos_sales_lines WHERE NOT is_duplicate",
     "gold.fact_pos_sales", 0.99),
    ("fact_footfall_vs_silver",
     "SELECT COUNT(*) FROM silver.footfall_hourly", "gold.fact_footfall", 1.0),
    ("fact_tenant_sales_vs_silver",
     "SELECT COUNT(*) FROM silver.tenant_sales_monthly", "gold.fact_tenant_sales", 1.0),
    ("fact_bookings_vs_silver",
     "SELECT COUNT(*) FROM silver.web_bookings", "gold.fact_bookings", 0.99),
    ("fact_web_sessions_vs_silver",
     "SELECT COUNT(*) FROM silver.web_sessions", "gold.fact_web_sessions", 1.0),
    ("fact_lesson_slots_vs_silver",
     "SELECT COUNT(*) FROM silver.lesson_slots", "gold.fact_lesson_slots", 1.0),
]


def check_row_counts(conn) -> list[CheckResult]:
    results = []
    for name, silver_sql, gold_table, min_ratio in ROW_COUNT_PAIRS:
        silver_n = _scalar(conn, silver_sql)
        gold_n = _scalar(conn, f"SELECT COUNT(*) FROM {gold_table}")
        ratio = (gold_n / silver_n) if silver_n else 1.0
        results.append(CheckResult(
            check_name=name, check_type="row_count", schema_name="gold",
            table_name=gold_table.split(".")[-1],
            status="pass" if ratio >= min_ratio else "fail",
            expected_value=f">= {min_ratio:.0%} of silver ({silver_n})",
            actual_value=str(gold_n), details=f"ratio={ratio:.4f}",
        ))
    return results


# ---------------------------------------------------------------------
# uniqueness. Split into a silver-only group and a gold-only group so
# run.py (session 12's orchestrator) can gate right after silver, before
# gold has even been built, rather than only ever checking at the very end.
# ---------------------------------------------------------------------
SILVER_UNIQUENESS_CHECKS = [
    # (check_name, schema, table, sql counting violating groups)
    ("pos_sales_lines_dedup_correct", "silver", "pos_sales_lines", """
        SELECT COUNT(*) FROM (
            SELECT invoice_id, sales_id, invoice_date, item_id, qty, sales_price_kwd,
                   line_amount_kwd, created_datetime, payment_mode, cust_account
            FROM silver.pos_sales_lines WHERE NOT is_duplicate
            GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 HAVING COUNT(*) > 1
        ) v
    """),
]

GOLD_UNIQUENESS_CHECKS = [
    ("dim_tenant_one_current_per_tenant", "gold", "dim_tenant", """
        SELECT COUNT(*) FROM (
            SELECT tenant_id FROM gold.dim_tenant WHERE is_current
            GROUP BY tenant_id HAVING COUNT(*) > 1
        ) v
    """),
    ("fact_footfall_gate_date_hour_unique", "gold", "fact_footfall", """
        SELECT COUNT(*) FROM (
            SELECT gate_key, date_key, hour FROM gold.fact_footfall
            GROUP BY 1, 2, 3 HAVING COUNT(*) > 1
        ) v
    """),
    ("fact_tenant_sales_version_unique", "gold", "fact_tenant_sales", """
        SELECT COUNT(*) FROM (
            SELECT tenant_key, month_date_key, submission_version FROM gold.fact_tenant_sales
            GROUP BY 1, 2, 3 HAVING COUNT(*) > 1
        ) v
    """),
    ("fact_membership_months_contract_month_unique", "gold", "fact_membership_months", """
        SELECT COUNT(*) FROM (
            SELECT contract_id, month_date_key FROM gold.fact_membership_months
            GROUP BY 1, 2 HAVING COUNT(*) > 1
        ) v
    """),
]


def check_uniqueness(conn, checks: list = None) -> list[CheckResult]:
    results = []
    for name, schema, table, sql in (checks if checks is not None else SILVER_UNIQUENESS_CHECKS + GOLD_UNIQUENESS_CHECKS):
        violations = _scalar(conn, sql)
        results.append(CheckResult(
            check_name=name, check_type="uniqueness", schema_name=schema, table_name=table,
            status="pass" if violations == 0 else "fail",
            expected_value="0", actual_value=str(violations),
        ))
    return results


# ---------------------------------------------------------------------
# referential_integrity
# ---------------------------------------------------------------------
FK_CHECKS = [
    # (check_name, fact_table, fk_col, dim_table, dim_key_col)
    ("fact_pos_sales_date_key_valid", "gold.fact_pos_sales", "date_key", "gold.dim_date", "date_key"),
    ("fact_pos_sales_product_key_valid", "gold.fact_pos_sales", "product_key", "gold.dim_product", "product_key"),
    ("fact_bookings_customer_key_valid", "gold.fact_bookings", "customer_key", "gold.dim_customer", "customer_key"),
    ("fact_bookings_product_key_valid", "gold.fact_bookings", "product_key", "gold.dim_product", "product_key"),
    ("fact_membership_months_member_key_valid", "gold.fact_membership_months", "member_key", "gold.dim_member", "member_key"),
    ("fact_lesson_slots_instructor_key_valid", "gold.fact_lesson_slots", "instructor_key", "gold.dim_instructor", "instructor_key"),
    ("fact_tenant_sales_tenant_key_valid", "gold.fact_tenant_sales", "tenant_key", "gold.dim_tenant", "tenant_key"),
]


def check_referential_integrity(conn) -> list[CheckResult]:
    results = []
    for name, fact_table, fk_col, dim_table, dim_key_col in FK_CHECKS:
        sql = f"""
            SELECT COUNT(*) FROM {fact_table} f
            WHERE f.{fk_col} IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM {dim_table} d WHERE d.{dim_key_col} = f.{fk_col})
        """
        orphans = _scalar(conn, sql)
        results.append(CheckResult(
            check_name=name, check_type="referential_integrity", schema_name="gold",
            table_name=fact_table.split(".")[-1],
            status="pass" if orphans == 0 else "fail",
            expected_value="0", actual_value=str(orphans),
            details=f"{fk_col} -> {dim_table}.{dim_key_col}",
        ))

    # Business-rule referential check, not a plain FK: stable_key is only
    # meaningful for boarding contracts (see 02_gold.sql's comment on
    # fact_membership_months.stable_key), so it must be set for every
    # horse_boarding row and null for every other contract_type.
    n = _scalar(conn, """
        SELECT COUNT(*) FROM gold.fact_membership_months
        WHERE (contract_type = 'horse_boarding') != (stable_key IS NOT NULL)
    """)
    results.append(CheckResult(
        check_name="membership_months_stable_key_matches_boarding_type",
        check_type="referential_integrity", schema_name="gold", table_name="fact_membership_months",
        status="pass" if n == 0 else "fail", expected_value="0", actual_value=str(n),
        details="stable_key must be set iff contract_type = horse_boarding",
    ))

    # dim_gate.primary_venue_served holds a venue_id rather than a
    # venue_key and carries no database FK, deliberately: the gold
    # dimension loaders TRUNCATE ... CASCADE, so a constraint pointing at
    # dim_venue would let a dim_venue rebuild take dim_gate's rows with it.
    # The guarantee is enforced here instead. Null is valid and excluded on
    # purpose: it means the gate serves the whole site (the Main Gate case),
    # which is a real value, not a missing one.
    n = _scalar(conn, """
        SELECT COUNT(*) FROM gold.dim_gate g
        WHERE g.primary_venue_served IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM gold.dim_venue v WHERE v.venue_id = g.primary_venue_served)
    """)
    results.append(CheckResult(
        check_name="dim_gate_primary_venue_served_valid",
        check_type="referential_integrity", schema_name="gold", table_name="dim_gate",
        status="pass" if n == 0 else "fail", expected_value="0", actual_value=str(n),
        details="primary_venue_served -> gold.dim_venue.venue_id (null means serves whole site)",
    ))

    # The spatial columns come from config, not from a source file, and are
    # reapplied after each dimension rebuild by
    # pipeline/load/spatial_metadata.py. If that step is ever skipped or a
    # new gate/venue/tenant appears in the warehouse without a matching
    # config entry, the column goes quietly null and any zone breakdown
    # silently loses rows. This check is what makes that loud.
    for table, columns in [
        ("gold.dim_gate", ["gate_label", "zone"]),
        ("gold.dim_venue", ["zone", "gate_proximity"]),
        ("gold.dim_tenant", ["zone", "gate_proximity"]),
    ]:
        predicate = " OR ".join(f"{col} IS NULL" for col in columns)
        n = _scalar(conn, f"SELECT COUNT(*) FROM {table} WHERE {predicate}")
        results.append(CheckResult(
            check_name=f"{table.split('.')[-1]}_spatial_metadata_populated",
            check_type="referential_integrity", schema_name="gold",
            table_name=table.split(".")[-1],
            status="pass" if n == 0 else "fail", expected_value="0", actual_value=str(n),
            details=f"{', '.join(columns)} set from config spatial section",
        ))

    return results


# ---------------------------------------------------------------------
# value_range
# ---------------------------------------------------------------------
def check_value_ranges(conn) -> list[CheckResult]:
    results = []

    n = _scalar(conn, "SELECT COUNT(*) FROM gold.fact_pos_sales WHERE is_refund AND line_amount_kwd >= 0")
    results.append(CheckResult(
        "pos_sales_refund_has_negative_amount", "value_range", "gold", "fact_pos_sales",
        "pass" if n == 0 else "fail", "0", str(n),
        "every is_refund row must have line_amount_kwd < 0",
    ))

    n = _scalar(conn, "SELECT COUNT(*) FROM gold.fact_footfall WHERE count_in < 0 OR count_out < 0")
    results.append(CheckResult(
        "footfall_counts_non_negative", "value_range", "gold", "fact_footfall",
        "pass" if n == 0 else "fail", "0", str(n),
    ))

    n = _scalar(conn, "SELECT COUNT(*) FROM gold.fact_lesson_slots WHERE attended IS NOT NULL AND attended > booked")
    results.append(CheckResult(
        "lesson_slots_attended_not_above_booked", "value_range", "gold", "fact_lesson_slots",
        "pass" if n == 0 else "fail", "0", str(n),
    ))

    n = _scalar(conn, """
        SELECT COUNT(*) FROM gold.fact_tenant_sales
        WHERE gross_sales_kwd IS NOT NULL AND net_sales_kwd IS NOT NULL
          AND net_sales_kwd > gross_sales_kwd
    """)
    results.append(CheckResult(
        "tenant_sales_net_not_above_gross", "value_range", "gold", "fact_tenant_sales",
        "pass" if n == 0 else "fail", "0", str(n),
    ))

    return results


# ---------------------------------------------------------------------
# freshness
# ---------------------------------------------------------------------
FRESHNESS_TABLES = [
    ("pos_sales_lines_freshness", "silver.pos_sales_lines", "invoice_date"),
    ("footfall_freshness", "silver.footfall_hourly", "footfall_date"),
    ("web_bookings_freshness", "silver.web_bookings", "booking_datetime::date"),
    ("web_sessions_freshness", "silver.web_sessions", "session_date"),
]
FRESHNESS_TOLERANCE_DAYS = 7


def check_freshness(conn, config: dict) -> list[CheckResult]:
    window_end = pd.Timestamp(config["generator"]["date_range"]["end"]).date()
    results = []
    for name, table, date_col in FRESHNESS_TABLES:
        max_date = _scalar(conn, f"SELECT MAX({date_col}) FROM {table}")
        # staleness, not distance: a source running slightly *past* the
        # window (like the boundary refunds/cancellations already known
        # about) is not a freshness problem, only lagging behind it is.
        staleness_days = (window_end - max_date).days if max_date else None
        status = "pass" if staleness_days is not None and staleness_days <= FRESHNESS_TOLERANCE_DAYS else "fail"
        results.append(CheckResult(
            check_name=name, check_type="freshness", schema_name="silver", table_name=table.split(".")[-1],
            status=status, expected_value=f"max date within {FRESHNESS_TOLERANCE_DAYS}d of {window_end}",
            actual_value=str(max_date), details=f"staleness_days={staleness_days}",
        ))
    return results


# ---------------------------------------------------------------------
# Orchestration. _record runs a list of (conn) -> [CheckResult] producers
# inside one transaction and appends the results to dq.check_results -
# append, never replace_table's truncate, since this table is the audit
# trail across every run, not a rebuilt-each-time layer. run_silver_checks
# and run_gold_checks are the two gates pipeline/run.py actually calls, one
# right after silver lands and one after gold does; run_all just runs both
# under one run_id, for a standalone `python -m pipeline.dq.checks`.
# ---------------------------------------------------------------------
def _record(engine, run_id: str, check_fns: list) -> pd.DataFrame:
    def _run_checks():
        with engine.begin() as conn:
            results = []
            for fn in check_fns:
                results += fn(conn)
            return results

    results = with_retries(_run_checks)
    df = pd.DataFrame([asdict(r) for r in results])
    df.insert(0, "run_id", run_id)
    df["severity"] = df["check_type"].map(CHECK_TYPE_SEVERITY)

    def _write():
        with engine.begin() as conn:
            df.to_sql("check_results", conn, schema="dq", if_exists="append", index=False, method="multi")

    with_retries(_write)
    return df


def run_silver_checks(engine, config: dict, run_id: str) -> pd.DataFrame:
    return _record(engine, run_id, [
        lambda conn: check_uniqueness(conn, SILVER_UNIQUENESS_CHECKS),
        lambda conn: check_freshness(conn, config),
    ])


def run_gold_checks(engine, run_id: str) -> pd.DataFrame:
    return _record(engine, run_id, [
        check_row_counts,
        lambda conn: check_uniqueness(conn, GOLD_UNIQUENESS_CHECKS),
        check_referential_integrity,
        check_value_ranges,
    ])


def run_all(engine: sqlalchemy.engine.Engine | None = None, config: dict | None = None) -> pd.DataFrame:
    engine = engine or get_engine()
    config = config or load_config()
    run_id = str(uuid.uuid4())
    silver_df = run_silver_checks(engine, config, run_id)
    gold_df = run_gold_checks(engine, run_id)
    return pd.concat([silver_df, gold_df], ignore_index=True)


def has_critical_failures(df: pd.DataFrame) -> bool:
    return bool(((df["status"] == "fail") & (df["severity"] == "error")).any())


def summarize(df: pd.DataFrame) -> str:
    failed = df[df["status"] == "fail"]
    critical = failed[failed["severity"] == "error"]
    lines = [f"DQ: {len(df)} checks run, {len(failed)} failed ({len(critical)} error-severity)."]
    for _, row in failed.sort_values("severity").iterrows():
        lines.append(
            f"  [{row['severity']}] {row['check_name']}: "
            f"expected {row['expected_value']}, got {row['actual_value']}"
        )
    return "\n".join(lines)


if __name__ == "__main__":
    df = run_all()
    print(summarize(df))
