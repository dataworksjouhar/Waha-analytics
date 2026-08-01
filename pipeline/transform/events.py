"""Silver transform for Source 5 (events calendar). One planted DQ issue:
an event with end_date before start_date. It is flagged, not corrected -
silently swapping the dates back would hide the exact data quality issue
the demo is meant to surface.

    python -m pipeline.transform.events
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.transform.util import read_bronze, replace_silver_table


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    raw = read_bronze(engine, "bronze.events_raw")

    start_date = pd.to_datetime(raw["start_date"]).dt.date
    end_date = pd.to_datetime(raw["end_date"]).dt.date
    end_before_start = end_date < start_date

    df = pd.DataFrame({
        "event_id": raw["event_id"],
        "event_name": raw["event_name"],
        "event_type": raw["event_type"],
        "start_date": start_date,
        "end_date": end_date,
        "expected_attendance": pd.to_numeric(raw["expected_attendance"]).astype("Int64"),
        "_source_file": raw["_source_file"],
        "_dq_flags": [["end_before_start"] if flagged else [] for flagged in end_before_start],
    })
    return replace_silver_table(engine, "silver.events", df)


if __name__ == "__main__":
    n = transform()
    print(f"events: {n} rows")
