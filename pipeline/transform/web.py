"""Silver transform for Source 4 (booking website): sessions and bookings.

web_sessions has no planted imperfections, so it's a straight cast.
web_bookings has two: a missing channel (direct attribution loss, flagged
rather than backfilled with a guess) and cancellations arriving as a
separate negative-amount row rather than mutating the original booking,
which is exactly how a real e-commerce system handles it, so is_cancelled
is derived rather than corrected.

    python -m pipeline.transform.web
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table


def transform_sessions(engine: sqlalchemy.engine.Engine) -> int:
    raw = read_table(engine, "bronze.web_sessions_raw")
    df = pd.DataFrame({
        "session_date": pd.to_datetime(raw["date"]).dt.date,
        "channel": raw["channel"],
        "device": raw["device"],
        "sessions": pd.to_numeric(raw["sessions"]).astype("Int64"),
        "engaged_sessions": pd.to_numeric(raw["engaged_sessions"]).astype("Int64"),
        "users": pd.to_numeric(raw["users"]).astype("Int64"),
        "_source_file": raw["_source_file"],
    })
    return replace_table(engine, "silver.web_sessions", df)


def transform_bookings(engine: sqlalchemy.engine.Engine) -> int:
    raw = read_table(engine, "bronze.web_bookings_raw")

    amount = pd.to_numeric(raw["amount_kwd"])
    channel_missing = raw["channel"].isna()

    df = pd.DataFrame({
        "booking_id": raw["booking_id"],
        "booking_datetime": pd.to_datetime(raw["booking_datetime"]),
        "product_code": raw["product_code"],
        "qty": pd.to_numeric(raw["qty"]),
        "amount_kwd": amount,
        "channel": raw["channel"],
        "customer_id": raw["customer_id"],
        "is_cancelled": amount < 0,
        "_source_file": raw["_source_file"],
        "_dq_flags": [["channel_missing"] if missing else [] for missing in channel_missing],
    })
    return replace_table(engine, "silver.web_bookings", df)


def transform_all(engine: sqlalchemy.engine.Engine | None = None) -> dict[str, int]:
    engine = engine or get_engine()
    return {
        "web_sessions": transform_sessions(engine),
        "web_bookings": transform_bookings(engine),
    }


if __name__ == "__main__":
    for name, n in transform_all().items():
        print(f"{name}: {n} rows")
