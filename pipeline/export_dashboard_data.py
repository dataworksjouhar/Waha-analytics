"""Applies the reporting views in sql/ and exports them to static JSON for
the dashboard to read.

Deliberately NOT part of pipeline/run.py's bronze -> silver -> gold
orchestration. That pipeline builds the warehouse; this script serves one
particular consumer of it. A client who takes the Power BI tier instead of
the React one runs the pipeline and never runs this, pointing Power BI
straight at the same gold views. Keeping the two separate is what makes
"same pipeline, either frontend" true rather than aspirational.

Why static JSON at all, rather than the frontend querying Postgres: the
free-tier database pauses after inactivity, so a recruiter opening the
dashboard cold would hit a wake-up delay or an error; and a public frontend
holding database credentials is a security problem with no upside here,
because the data is synthetic and fixed, so there is nothing to refresh.
For a real client the same React components point at a live API instead.

The output in app/public/data/ is committed to the repo rather than
gitignored like data/bronze/. It has to be: the static host builds the
dashboard with no database credentials and no network path to Supabase, so
if the JSON is not in the checkout there is nothing to deploy.

    python -m pipeline.export_dashboard_data
"""

from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine, with_retries
from pipeline.util import load_config, read_table

REPO_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = REPO_ROOT / "sql"
OUTPUT_DIR = REPO_ROOT / "app" / "public" / "data"

# Maps each metric key in config's metrics.enabled list to the view that
# answers it. The config decides which metrics a client gets; this registry
# knows how each one is served. A metric enabled in config with no entry
# here is a hard error rather than a silent omission: a dashboard quietly
# missing a metric the client was promised is worse than a failed export.
METRIC_VIEWS = {
    "footfall_vs_ly_weather": "vw_footfall_daily",
    "footfall_to_sales_conversion": "vw_footfall_sales_conversion",
    "turnover_rent_owed_vs_collected": "vw_tenant_turnover_rent",
    "sales_per_sqm_by_category": "vw_tenant_sales_per_sqm",
    "online_vs_walkin_mix": "vw_ticket_channel_mix",
    "website_conversion_by_channel": "vw_web_channel_conversion",
    "event_roi": "vw_event_roi",
    "membership_active_base_and_churn": "vw_membership_active_churn",
    "revenue_summary_own_vs_rental": "vw_revenue_summary",
    "avg_transaction_value_by_venue": "vw_avg_transaction_value",
    "lesson_slot_utilization": "vw_lesson_utilization",
    "stable_occupancy_and_boarding_revenue": "vw_stable_occupancy",
}

# Exported regardless of the metrics list. Tenant submission compliance is
# not a headline metric (architecture doc section 9) but underpins the
# turnover rent figure: "this tenant owes X" means less without "and they
# filed 40 days late, twice restated" next to it.
SUPPORTING_VIEWS = ["vw_tenant_compliance"]


def deploy_views(engine: sqlalchemy.engine.Engine) -> list[str]:
    """Applies sql/*.sql in filename order. Every statement is CREATE OR
    REPLACE VIEW, so re-running is always safe.

    Uses exec_driver_sql, not sqlalchemy.text(), because the views contain
    Postgres cast syntax (`::date`). text() parses `:name` as a bind
    parameter placeholder and would read `::date` as one, failing on a
    missing parameter. exec_driver_sql hands the SQL to psycopg2 untouched.
    """
    applied = []
    for sql_file in sorted(SQL_DIR.glob("*.sql")):
        sql_text = sql_file.read_text(encoding="utf-8")

        def _apply(sql_text=sql_text):
            with engine.begin() as conn:
                conn.exec_driver_sql(sql_text)

        with_retries(_apply)
        applied.append(sql_file.name)
        print(f"  applied {sql_file.name}")
    return applied


def _json_default(value):
    """Postgres NUMERIC arrives as Decimal and DATE as datetime.date;
    neither is JSON-serialisable. Decimals become floats (these are display
    figures for charts, not money being moved, so float precision is fine)
    and dates become ISO strings, which is what JavaScript's Date parses."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"cannot serialise {type(value).__name__}: {value!r}")


def _to_records(df: pd.DataFrame) -> list[dict]:
    """Frame to a list of flat dicts, with pandas' missing-value markers
    (NaN, NaT, pd.NA) turned into None so they serialise as JSON null.
    A null in the output is meaningful here, not noise: no year-ago figure
    for the first year of history, no attendance where a coach did not mark
    it. Those gaps are part of what the dashboard has to show honestly."""
    records = df.to_dict(orient="records")
    return [{k: (None if pd.isna(v) is True else v) for k, v in row.items()} for row in records]


def _write_json(path: Path, payload) -> None:
    path.write_text(
        json.dumps(payload, default=_json_default, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def export_view(engine: sqlalchemy.engine.Engine, view: str) -> int:
    df = read_table(engine, f"gold.{view}")
    _write_json(OUTPUT_DIR / f"{view}.json", _to_records(df))
    return len(df)


def export_dq_summary(engine: sqlalchemy.engine.Engine) -> int:
    """The most recent pipeline run's data quality results. The dashboard
    surfaces these rather than hiding them: the whole argument of this
    project is that flagged problems beat invisible ones."""

    def _read():
        with engine.connect() as conn:
            return pd.read_sql(
                """
                SELECT check_name, check_type, schema_name, table_name,
                       status, severity, expected_value, actual_value,
                       details, checked_at
                FROM dq.check_results
                WHERE run_id = (
                    SELECT run_id FROM dq.check_results
                    ORDER BY checked_at DESC LIMIT 1
                )
                ORDER BY severity, status, check_name
                """,
                conn,
            )

    df = with_retries(_read)
    _write_json(OUTPUT_DIR / "dq_summary.json", _to_records(df))
    return len(df)


def export_meta(config: dict, manifest: dict[str, int]) -> None:
    """Client identity and branding, read from config rather than hardcoded
    in React. Rebranding the dashboard for a different client is then a YAML
    edit, which is the same claim the pipeline makes, extended to the
    frontend."""
    client = config["client"]
    branding = config.get("branding", {})
    date_range = config["generator"]["date_range"]

    _write_json(
        OUTPUT_DIR / "meta.json",
        {
            "client": {
                "name": client["name"],
                "short_name": client["short_name"],
                "currency": client["currency"],
                "timezone": client["timezone"],
                "weekend": client["weekend"],
            },
            "branding": {
                "primary_color": branding.get("primary_color"),
                "logo": branding.get("logo"),
            },
            "date_range": {"start": date_range["start"], "end": date_range["end"]},
            "metrics_enabled": config["metrics"]["enabled"],
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "row_counts": manifest,
        },
    )


def run(engine: sqlalchemy.engine.Engine | None = None) -> dict[str, int]:
    engine = engine or get_engine()
    config = load_config()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Applying reporting views:")
    deploy_views(engine)

    enabled = config["metrics"]["enabled"]
    unknown = [m for m in enabled if m not in METRIC_VIEWS]
    if unknown:
        raise KeyError(
            f"metrics enabled in config with no view registered in METRIC_VIEWS: {unknown}"
        )

    views = [METRIC_VIEWS[m] for m in enabled] + SUPPORTING_VIEWS
    skipped = [m for m in METRIC_VIEWS if m not in enabled]
    if skipped:
        print(f"Metrics disabled in config, not exported: {', '.join(skipped)}")

    print(f"Exporting {len(views)} views to {OUTPUT_DIR.relative_to(REPO_ROOT)}:")
    manifest = {}
    for view in views:
        manifest[view] = export_view(engine, view)
        print(f"  {view}.json: {manifest[view]} rows")

    manifest["dq_summary"] = export_dq_summary(engine)
    print(f"  dq_summary.json: {manifest['dq_summary']} rows")

    export_meta(config, manifest)
    print("  meta.json written")

    return manifest


if __name__ == "__main__":
    run()
    print("Dashboard data exported.")
