"""Gold dimension build for dim_date and its 1:1 weather extension.

dim_date's calendar columns come directly from
generator.calendars.build_date_spine(), not a second reimplementation of
the same Ramadan/holiday/season rules. That function is pure and
config-driven (no random generation - it only reads
config["generator"]["date_range"], client.weekend and the calendar
section of client_waha.yml), and its own docstring says it produces
"gold.dim_date's columns": it was written to be this table's source, not
just the synthetic-data generator's. The one wrinkle worth naming: this
makes pipeline/ depend on generator/, a demo-only component a real future
client would not ship. Accepted for now rather than duplicating calendar
logic a second time; if generator/ is ever dropped for a real client,
this calendar logic would need to move to a module both sides import.

dim_date_weather is a 1:1 extension kept separate from dim_date itself,
per the architecture doc, so dim_date stays a generic, weather-free
conformed dimension reusable by any client. Its FK to dim_date means
dim_date must load first, and its own load must truncate-and-reload every
time dim_date does (see the cascade note on replace_table).

    python -m pipeline.load.dim_date
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from generator.calendars import build_date_spine
from pipeline.db import get_engine
from pipeline.util import load_config, read_table, replace_table


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    spine = build_date_spine(load_config())
    spine["full_date"] = spine["full_date"].dt.date
    return replace_table(engine, "gold.dim_date", spine, cascade=True)


def transform_weather(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    weather = read_table(engine, "silver.weather_daily")

    with engine.begin() as conn:
        dates = pd.read_sql("SELECT date_key, full_date FROM gold.dim_date", conn)

    merged = dates.merge(weather, left_on="full_date", right_on="weather_date", how="inner")

    df = pd.DataFrame({
        "date_key": merged["date_key"],
        "temp_max_c": merged["temp_max_c"],
        "temp_min_c": merged["temp_min_c"],
        "dust_storm_flag": merged["dust_storm_flag"],
        "rain_mm": merged["rain_mm"],
    })
    return replace_table(engine, "gold.dim_date_weather", df)


def transform_all(engine: sqlalchemy.engine.Engine | None = None) -> dict[str, int]:
    engine = engine or get_engine()
    return {
        "dim_date": transform(engine),
        "dim_date_weather": transform_weather(engine),
    }


if __name__ == "__main__":
    for name, n in transform_all().items():
        print(f"{name}: {n} rows")
