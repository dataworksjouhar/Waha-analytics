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
# filed 40 days late, twice restated" next to it. The two site plan views
# feed the map, which is a way of showing metrics 1, 3 and 4 rather than a
# metric of its own.
SUPPORTING_VIEWS = [
    "vw_tenant_compliance",
    "vw_tenant_site_metrics",
    "vw_footfall_gate_hour_monthly",
    # Footfall split by entrance. Supports metric 1 (where the traffic
    # went, not just how much) and metric 2 (the narrower per-entrance
    # denominator), without either metric changing what it claims.
    "vw_footfall_by_zone",
    # Metric 6 by month. The headline view averages the time dimension
    # away, which hides a channel whose conversion is decaying while its
    # volume holds up. Supporting rather than a metric of its own: it
    # answers the same question at a grain that can show a trend.
    "vw_web_channel_conversion_monthly",
    # Metric 11 by month. The headline view averages a summer trough into
    # a winter peak, which turns "beginner is full and advanced is half
    # empty every month of peak season" into a mild-sounding annual gap.
    "vw_lesson_utilization_monthly",
    # Instructors with no lessons at all. The utilization view can only
    # show instructors who appear in the fact, so a roster gap is
    # invisible there by construction.
    "vw_instructor_coverage",
]


def deploy_views(engine: sqlalchemy.engine.Engine) -> list[str]:
    """Applies sql/*.sql in filename order. Every statement is CREATE OR
    REPLACE VIEW, so re-running is always safe.

    Not sqlalchemy.text(): the views contain Postgres cast syntax
    (`::date`), and text() parses `:name` as a bind parameter placeholder,
    so it would read `::date` as one and fail on a missing parameter.

    Not exec_driver_sql either, which was the previous approach and had
    the mirror-image bug one level down. SQLAlchemy hands psycopg2 an
    empty parameter dict, and psycopg2 only skips its own `%`
    interpolation when no parameters are passed at all. Any `%` in the
    SQL therefore became a broken format placeholder: a `LIKE '%x%'` in a
    future view, or (how this was found) a percent sign inside a comment.

    So we drop to the driver cursor and execute with the statement as its
    only argument, which is the documented way to tell psycopg2 that the
    SQL is literal and there is nothing to interpolate.
    """
    applied = []
    for sql_file in sorted(SQL_DIR.glob("*.sql")):
        sql_text = sql_file.read_text(encoding="utf-8")

        def _apply(sql_text=sql_text):
            with engine.begin() as conn:
                cursor = conn.connection.cursor()
                try:
                    cursor.execute(sql_text)
                finally:
                    cursor.close()

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


def export_site_plan(engine: sqlalchemy.engine.Engine, config: dict) -> int:
    """Resolves the site plan config into finished geometry.

    The layout math happens here rather than in the browser for one
    reason: a plot's size is data, not decoration. Width comes from
    dim_tenant.unit_sqm, so a lease that changes size redraws the map on
    the next pipeline run. Doing that arithmetic in Python keeps it in one
    testable place and leaves the React component with nothing to do but
    draw rectangles it is handed.

    Unit sizes are read from the CURRENT version of dim_tenant, not from
    the selected month, so a unit whose tenant has closed (U-112, Al Reef
    Bakery, lease ended March 2025) still occupies its floor area on the
    plan. A closed shop does not stop being a shop-sized hole in the
    terrace, and drawing it as absent would hide a vacancy, which is the
    single most important thing a leasing manager wants to see.
    """
    plan = config["site_plan"]
    px_per_sqm = plan["px_per_sqm"]
    depth = plan["terrace_depth_px"]

    def _read():
        with engine.connect() as conn:
            tenants = pd.read_sql(
                """
                SELECT tenant_id, tenant_name, category, unit_no, unit_sqm, status
                FROM gold.dim_tenant WHERE is_current
                """,
                conn,
            )
            venues = pd.read_sql("SELECT venue_id, venue_name, venue_type FROM gold.dim_venue", conn)
            gates = pd.read_sql("SELECT gate_id, gate_name, description FROM gold.dim_gate", conn)
        return tenants, venues, gates

    tenants, venues, gates = with_retries(_read)
    by_unit = {row["unit_no"]: row for _, row in tenants.iterrows()}
    venue_names = {row["venue_id"]: row for _, row in venues.iterrows()}
    gate_names = {row["gate_id"]: row for _, row in gates.iterrows()}

    units = []
    for terrace in plan["terraces"]:
        x, y = terrace["origin"]
        # A terrace runs either west-to-east or north-to-south. Shop DEPTH
        # is the fixed dimension either way and FRONTAGE varies with floor
        # area, which is how a real retail terrace is actually built: every
        # unit is as deep as the building, and a bigger shop is a wider
        # shopfront, not a deeper one.
        direction = terrace.get("direction", "east")
        if direction not in ("east", "south"):
            raise ValueError(f"site_plan terrace {terrace['id']}: direction must be east or south")

        for unit_no in terrace["units"]:
            tenant = by_unit.get(unit_no)
            if tenant is None:
                # A unit in the drawing with no matching row in the
                # warehouse is a config error worth failing on, not a gap
                # to paper over: the map would silently lose a shop.
                raise KeyError(f"site_plan terrace {terrace['id']} references unknown unit {unit_no}")

            frontage = float(tenant["unit_sqm"]) * px_per_sqm / depth
            width, height = (frontage, depth) if direction == "east" else (depth, frontage)

            units.append(
                {
                    "unit_no": unit_no,
                    "terrace_id": terrace["id"],
                    "terrace_label": terrace["label"],
                    "orientation": "horizontal" if direction == "east" else "vertical",
                    "tenant_id": tenant["tenant_id"],
                    "tenant_name": tenant["tenant_name"],
                    "category": tenant["category"],
                    "status": tenant["status"],
                    "unit_sqm": float(tenant["unit_sqm"]),
                    "x": round(x, 2),
                    "y": round(y, 2),
                    "width": round(width, 2),
                    "height": round(height, 2),
                }
            )
            if direction == "east":
                x += frontage
            else:
                y += frontage

    _write_json(
        OUTPUT_DIR / "site_plan.json",
        {
            "viewbox": plan["viewbox"],
            "note": (
                f"Stylised schematic of {config['client']['site_name']}. Unit areas are "
                "true to dim_tenant.unit_sqm; positions are illustrative."
            ),
            "units": units,
            "venues": [
                {
                    "venue_id": v["venue_id"],
                    "label": v["label"],
                    "rect": v["rect"],
                    "venue_name": venue_names[v["venue_id"]]["venue_name"],
                    "venue_type": venue_names[v["venue_id"]]["venue_type"],
                }
                for v in plan["venues"]
            ],
            "gates": [
                {
                    "gate_id": g["gate_id"],
                    "at": g["at"],
                    "label_side": g["label_side"],
                    "gate_name": gate_names[g["gate_id"]]["gate_name"],
                    "description": gate_names[g["gate_id"]]["description"],
                }
                for g in plan["gates"]
            ],
            "promenade": plan["promenade"],
        },
    )
    return len(units)


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
                "site_name": client["site_name"],
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

    manifest["site_plan"] = export_site_plan(engine, config)
    print(f"  site_plan.json: {manifest['site_plan']} units")

    export_meta(config, manifest)
    print("  meta.json written")

    return manifest


if __name__ == "__main__":
    run()
    print("Dashboard data exported.")
