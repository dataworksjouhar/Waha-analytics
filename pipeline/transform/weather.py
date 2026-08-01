"""Silver transform for Source 6 (weather): clean by design, so this is
pure type-casting, no dedup or flagging needed.

    python -m pipeline.transform.weather
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    raw = read_table(engine, "bronze.weather_raw")
    df = pd.DataFrame({
        "weather_date": pd.to_datetime(raw["date"]).dt.date,
        "temp_max_c": pd.to_numeric(raw["temp_max_c"]),
        "temp_min_c": pd.to_numeric(raw["temp_min_c"]),
        "dust_storm_flag": raw["dust_storm_flag"] == "True",
        "rain_mm": pd.to_numeric(raw["rain_mm"]),
        "_source_file": raw["_source_file"],
    })
    return replace_table(engine, "silver.weather_daily", df)


if __name__ == "__main__":
    n = transform()
    print(f"weather_daily: {n} rows")
