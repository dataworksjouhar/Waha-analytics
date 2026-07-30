"""Single entry point: builds two years of synthetic Al Waha bronze files.

    python generator/generate.py

Deterministic given generator.seed in config/client_waha.yml. Building the
DataFrames is sessions 2-5's work; this module's only job is turning those
DataFrames into the file shapes described in the architecture doc (one CSV
per day for the daily-drop sources, point-in-time monthly snapshots for
contracts, one file per tenant-month submission, static for events/master
data) and layering generator/mess.py's imperfections on top.

data/bronze/ is gitignored and rebuilt from scratch on every run, so
re-running never mixes rows from a previous run with a different row count.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

if __name__ == "__main__":
    # `python generator/generate.py` doesn't put the repo root on sys.path
    # the way `python -m generator.generate` would; add it so the absolute
    # `from generator.x import y` imports below resolve either way.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

from generator import mess
from generator.calendars import build_date_spine, get_rng, load_config
from generator.contracts import build_contracts
from generator.footfall import build_footfall
from generator.lessons import build_lessons
from generator.pos import build_pos_sales
from generator.tenants import build_tenant_sales
from generator.weather import build_weather
from generator.web import build_web_bookings, build_web_sessions

BRONZE_DIR = Path("data/bronze")
SEEDS_DIR = Path("data/seeds")


def _reset_bronze() -> None:
    if BRONZE_DIR.exists():
        shutil.rmtree(BRONZE_DIR)
    BRONZE_DIR.mkdir(parents=True)


def _write_daily(df: pd.DataFrame, date_col: str, source: str, filename_prefix: str) -> int:
    out_dir = BRONZE_DIR / source
    out_dir.mkdir(parents=True, exist_ok=True)
    df = df.copy()
    df["_date_key"] = pd.to_datetime(df[date_col]).dt.strftime("%Y%m%d")
    n_files = 0
    for date_key, day_df in df.groupby("_date_key"):
        day_df.drop(columns="_date_key").to_csv(out_dir / f"{filename_prefix}_{date_key}.csv", index=False)
        n_files += 1
    return n_files


def _write_contract_snapshots(contracts: pd.DataFrame, config: dict) -> int:
    """One file per month, containing every contract relevant to that month
    (started by month-end, not yet ended before month-start). Point-in-time
    correct: a contract that will be cancelled in month 15 still shows as
    active/null end_date in month 5's file, since that cancellation hadn't
    happened yet as of that export."""
    out_dir = BRONZE_DIR / "contracts"
    out_dir.mkdir(parents=True, exist_ok=True)

    start_dates = pd.to_datetime(contracts["start_date"])
    end_dates = pd.to_datetime(contracts["end_date"])
    months = pd.date_range(config["generator"]["date_range"]["start"], config["generator"]["date_range"]["end"], freq="MS")

    n_files = 0
    for month_start in months:
        month_end = month_start + pd.offsets.MonthEnd(0)
        relevant_mask = (start_dates <= month_end) & (end_dates.isna() | (end_dates >= month_start))
        if not relevant_mask.any():
            continue
        snapshot = contracts.loc[relevant_mask].copy()

        not_yet_ended = end_dates.loc[relevant_mask].isna() | (end_dates.loc[relevant_mask] > month_end)
        snapshot.loc[not_yet_ended.to_numpy(), "end_date"] = None
        snapshot.loc[not_yet_ended.to_numpy(), "status"] = "active"
        snapshot.loc[not_yet_ended.to_numpy(), "cancellation_date"] = None

        snapshot.to_csv(out_dir / f"contracts_{month_start.strftime('%Y%m')}.csv", index=False)
        n_files += 1
    return n_files


def _write_tenant_submissions(tenant_sales: pd.DataFrame, config: dict, rng, mess_on: bool) -> int:
    out_dir = BRONZE_DIR / "tenant_sales"
    out_dir.mkdir(parents=True, exist_ok=True)

    if mess_on:
        records = mess.build_tenant_submission_records(tenant_sales, config, rng)
    else:
        records = [
            {
                "tenant_id": row["tenant_id"],
                "month": row["month"],
                "filename": f"tenant_sales_{row['tenant_id'].lower()}_{row['month']}.csv",
                "dataframe": pd.DataFrame([{"date": f"{row['month']}-01", "gross_sales": row["gross_sales"]}]),
                "submitted_date": pd.Timestamp(f"{row['month']}-01") + pd.offsets.MonthEnd(0),
                "is_restatement": False,
            }
            for _, row in tenant_sales.iterrows()
        ]

    for rec in records:
        rec["dataframe"].to_csv(out_dir / rec["filename"], index=False)

    manifest = pd.DataFrame(
        [
            {
                "filename": r["filename"],
                "tenant_id": r["tenant_id"],
                "month": r["month"],
                "submitted_date": r["submitted_date"].date(),
                "is_restatement": r["is_restatement"],
            }
            for r in records
        ]
    )
    # submitted_date isn't a column a real tenant spreadsheet would carry;
    # it's normally inferred from file arrival time. A git-tracked repo
    # doesn't preserve simulated mtimes, so this manifest is the durable
    # stand-in the bronze extract layer (session 7) reads instead.
    manifest.to_csv(out_dir / "_submission_manifest.csv", index=False)
    return len(records)


def _copy_master_data(config: dict) -> None:
    out_dir = BRONZE_DIR / "master_data"
    out_dir.mkdir(parents=True, exist_ok=True)
    for filename in config["sources"]["master_data"]["files"]:
        shutil.copy(SEEDS_DIR / filename, out_dir / filename)


def main() -> None:
    config = load_config()
    mess_on = config["mess"]["enabled"]
    rng = get_rng(config)

    _reset_bronze()

    print("Building date spine and seasonality...")
    spine = build_date_spine(config)

    print("Building weather...")
    weather = build_weather(spine, config, rng)

    print("Building footfall...")
    footfall = build_footfall(spine, weather, config, rng)

    print("Building POS sales...")
    pos = build_pos_sales(spine, footfall, config, rng)

    print("Building web sessions and bookings...")
    sessions = build_web_sessions(spine, config, rng)
    bookings = build_web_bookings(spine, config, rng)

    print("Building tenant sales...")
    tenant_sales = build_tenant_sales(config, rng)

    print("Building contracts...")
    contracts = build_contracts(config, rng)

    print("Building lessons...")
    lessons = build_lessons(spine, config, rng)

    events = pd.read_csv(SEEDS_DIR / "events.csv")

    if mess_on:
        print("Injecting imperfections...")
        footfall = mess.inject_footfall_mess(footfall, config, rng)
        pos = mess.inject_pos_mess(pos, config, rng)
        bookings = mess.inject_web_bookings_mess(bookings, config, rng)
        events = mess.inject_events_mess(events, config)
        contracts = mess.inject_contracts_mess(contracts, config, rng)
        lessons = mess.inject_lessons_mess(lessons, config, rng)

    print("Writing bronze files...")
    counts = {
        "weather": _write_daily(weather, "date", "weather", "weather"),
        "footfall": _write_daily(footfall, "date", "footfall", "footfall"),
        "pos_sales": _write_daily(pos, "INVOICEDATE", "pos_sales", "d365_salesline"),
        "web_sessions": _write_daily(sessions, "date", "web_sessions", "web_sessions"),
        "web_bookings": _write_daily(bookings, "booking_datetime", "web_bookings", "web_bookings"),
        "lessons": _write_daily(lessons, "lesson_date", "lessons", "lessons"),
        "contracts": _write_contract_snapshots(contracts, config),
        "tenant_sales": _write_tenant_submissions(tenant_sales, config, rng, mess_on),
    }

    events_dir = BRONZE_DIR / "events"
    events_dir.mkdir(parents=True, exist_ok=True)
    events.to_csv(events_dir / "events.csv", index=False)
    counts["events"] = 1

    _copy_master_data(config)
    counts["master_data"] = len(config["sources"]["master_data"]["files"])

    print()
    print("Bronze file counts by source:")
    for source, n_files in counts.items():
        print(f"  {source}: {n_files} files")
    print("Done.")


if __name__ == "__main__":
    main()
