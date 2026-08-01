"""Gold fact build for fact_lesson_slots: lesson slot grain,
capacity/coverage fact. booked/capacity gives utilization, attended/booked
gives no-show rate - this table supplies the denominator side of metric
11; lesson package revenue itself lives in fact_bookings (source 8's
"revenue in one system, capacity in another" split, kept deliberately).
A direct mapping from silver.lesson_slots; horse_ids doesn't carry to gold
since no gold table needs it at this grain.

    python -m pipeline.load.fact_lesson_slots
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    silver = read_table(engine, "silver.lesson_slots")

    with engine.begin() as conn:
        dates = pd.read_sql("SELECT date_key, full_date FROM gold.dim_date", conn)
        instructors = pd.read_sql("SELECT instructor_key, instructor_id FROM gold.dim_instructor", conn)

    merged = silver.merge(dates, left_on="lesson_date", right_on="full_date", how="left")
    merged = merged.merge(instructors, on="instructor_id", how="left")

    df = pd.DataFrame({
        "lesson_id": merged["lesson_id"],
        "date_key": merged["date_key"].astype("Int64"),
        "instructor_key": merged["instructor_key"].astype("Int64"),
        "level": merged["level"],
        "capacity": merged["capacity"].astype("Int64"),
        "booked": merged["booked"].astype("Int64"),
        # attended is nullable in silver; read_sql hands nullable-int
        # Postgres columns back as float64 once any row is null (3.0, not
        # 3), which COPY then rejects into an INTEGER column - Int64
        # brings it back to a clean integer text representation.
        "attended": merged["attended"].astype("Int64"),
        "is_overbooked": merged["is_overbooked"],
    })
    return replace_table(engine, "gold.fact_lesson_slots", df)


if __name__ == "__main__":
    n = transform()
    print(f"fact_lesson_slots: {n} rows")
