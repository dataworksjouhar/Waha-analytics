"""Silver transform for Source 8 (lesson schedule and attendance): the
capacity denominator for riding-lesson utilization. Revenue for lesson
packages flows through bookings/POS as package purchases; this file only
supplies capacity, booked and attended counts, which is exactly the kind
of revenue-in-one-system/capacity-in-another split that makes utilization
metrics hard in practice.

Two imperfections, both left visible rather than corrected:
- attended is sometimes null (the coach didn't mark it) - the nullability
  itself is the signal, so no separate flag column is needed for it.
- booked sometimes exceeds capacity, kept as reported rather than
  clamped to capacity, since silently capping it would hide exactly the
  overbooking problem the utilization metric exists to surface. Flagged
  via is_overbooked rather than _dq_flags, matching how pos_sales_lines
  uses dedicated boolean columns for its two flags: _dq_flags is reserved
  for issues that don't already have a natural home in a typed column.

    python -m pipeline.transform.lessons
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.transform.util import read_bronze, replace_silver_table


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    raw = read_bronze(engine, "bronze.lessons_raw")

    capacity = pd.to_numeric(raw["capacity"]).astype("Int64")
    booked = pd.to_numeric(raw["booked"]).astype("Int64")

    df = pd.DataFrame({
        "lesson_id": raw["lesson_id"],
        "lesson_date": pd.to_datetime(raw["lesson_date"]).dt.date,
        "start_time": raw["start_time"],
        "instructor_id": raw["instructor_id"],
        "level": raw["level"],
        "capacity": capacity,
        "booked": booked,
        "attended": pd.to_numeric(raw["attended"], errors="coerce").astype("Int64"),
        "horse_ids": raw["horse_ids"].str.split(","),
        "is_overbooked": booked > capacity,
        "_source_file": raw["_source_file"],
    })

    return replace_silver_table(engine, "silver.lesson_slots", df)


if __name__ == "__main__":
    n = transform()
    print(f"lesson_slots: {n} rows")
