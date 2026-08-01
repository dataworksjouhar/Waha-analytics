"""Gold fact build for fact_footfall: gate x hour grain, aggregate/coverage
fact. A direct mapping from silver.footfall_hourly - gate_id is sourced
from the counter's stable sensor_id in silver (never the messy free-text
gate_name), so it always resolves against dim_gate with no crosswalk. The
imputation and outlier-correction flags carry straight through: they are
gold-layer facts in their own right, not silver-only bookkeeping.

    python -m pipeline.load.fact_footfall
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    silver = read_table(engine, "silver.footfall_hourly")

    with engine.begin() as conn:
        dates = pd.read_sql("SELECT date_key, full_date FROM gold.dim_date", conn)
        gates = pd.read_sql("SELECT gate_key, gate_id FROM gold.dim_gate", conn)

    merged = silver.merge(dates, left_on="footfall_date", right_on="full_date", how="left")
    merged = merged.merge(gates, on="gate_id", how="left")

    unmatched_gate = merged["gate_key"].isna().sum()
    if unmatched_gate:
        print(f"  warning: {unmatched_gate} footfall_hourly rows have no matching dim_gate row")

    df = pd.DataFrame({
        "date_key": merged["date_key"].astype("Int64"),
        "gate_key": merged["gate_key"].astype("Int64"),
        "hour": merged["hour"],
        "count_in": merged["count_in"],
        "count_out": merged["count_out"],
        "is_imputed": merged["is_imputed"],
        "is_outlier_corrected": merged["is_outlier_corrected"],
    })
    return replace_table(engine, "gold.fact_footfall", df)


if __name__ == "__main__":
    n = transform()
    print(f"fact_footfall: {n} rows")
