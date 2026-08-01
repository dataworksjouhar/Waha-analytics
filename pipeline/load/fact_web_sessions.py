"""Gold fact build for fact_web_sessions: date x channel x device grain,
aggregate fact by design (GA4-style exports arrive pre-aggregated, there
is no session-level row to grain down to). A direct mapping from
silver.web_sessions; channel_key is nullable in principle but in practice
every channel here also appears in the union that built dim_channel
(dim_simple.transform_channel unions web_sessions and web_bookings
channels), so no unmatched case is expected.

    python -m pipeline.load.fact_web_sessions
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    silver = read_table(engine, "silver.web_sessions")

    with engine.begin() as conn:
        dates = pd.read_sql("SELECT date_key, full_date FROM gold.dim_date", conn)
        channels = pd.read_sql("SELECT channel_key, channel_name FROM gold.dim_channel", conn)

    merged = silver.merge(dates, left_on="session_date", right_on="full_date", how="left")
    merged = merged.merge(channels, left_on="channel", right_on="channel_name", how="left")

    df = pd.DataFrame({
        "date_key": merged["date_key"].astype("Int64"),
        "channel_key": merged["channel_key"].astype("Int64"),
        "device": merged["device"],
        "sessions": merged["sessions"],
        "engaged_sessions": merged["engaged_sessions"],
        "users": merged["users"],
    })
    return replace_table(engine, "gold.fact_web_sessions", df)


if __name__ == "__main__":
    n = transform()
    print(f"fact_web_sessions: {n} rows")
