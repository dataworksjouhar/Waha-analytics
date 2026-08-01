"""Silver transform for Source 2 (footfall counters).

Three cleaning decisions:
- gate_id: the counter vendor's sensor_id is already the stable device
  identifier (G01-G04) and is never inconsistent; gate_name is the
  free-text label whose format rotates across files (Gate 1 / GATE_1 /
  G1). Rather than trusting either blindly, gate_id comes from sensor_id
  and gate_name is conformed through an alias table purely as a
  cross-check, flagging anything that doesn't resolve or that disagrees
  with sensor_id.
- is_imputed: the dead-sensor window is a run of nulls. Each null is
  filled with the mean of that same gate+hour reading across the
  surrounding two weeks (7 rows back, 7 forward within that gate+hour's
  own daily series, so it's really +/-7 calendar days, not +/-7 rows of
  the raw file). That follows the hour-of-day pattern without being noisy
  the way a single neighbouring day would be. Grouped on (gate_id, hour)
  only: mixing weekday and weekend into the same +/-7-day window is fine
  here since the window already spans both day types symmetrically.
- is_outlier_corrected: the double-counting run is detected, not assumed -
  a rolling median per gate+hour+day-type over a wide (61-occurrence)
  window is computed, and any value more than 1.5x that baseline is
  flagged and replaced with the median estimate. Grouping also has to
  split on day type (Kuwait weekend vs not, from config client.weekend):
  Friday/Saturday footfall is structurally ~1.6x weekday footfall
  (weekend_uplift_factor in config), so a median blended across both day
  types sits well below every real weekend reading, and the 1.5x
  threshold then flags almost every weekend hour on every gate as a false
  positive. Comparing a Friday only to nearby Fridays avoids that. The
  window still has to be wide enough that the real 14-day anomalous run
  is a small minority of it, or the median would follow the anomaly
  instead of catching it.

    python -m pipeline.transform.footfall
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.transform.util import load_config, read_bronze, replace_silver_table

GATE_NAME_ALIASES = {
    "Main Gate": "G01", "GATE_1": "G01", "G1": "G01",
    "North Gate": "G02", "GATE_2": "G02", "G2": "G02",
    "Equestrian Gate": "G03", "GATE_3": "G03", "G3": "G03",
    "East Gate": "G04", "GATE_4": "G04", "G4": "G04",
}

IMPUTE_WINDOW_DAYS = 7          # each side, for dead-sensor fill
OUTLIER_WINDOW_ROWS = 61        # wide enough that a 14-day anomaly is a minority
OUTLIER_RATIO_THRESHOLD = 1.5


def _impute_gate_hour_series(g: pd.DataFrame) -> pd.DataFrame:
    """One gate's one hour-of-day, across every date it appears. Fills
    dead-sensor nulls from the surrounding +/-7-day window."""
    g = g.sort_values("footfall_date").copy()

    was_null = {}
    for col in ("count_in", "count_out"):
        values = g[col].to_numpy(dtype=float).copy()  # pandas 3.x CoW can hand back a read-only view
        was_null[col] = np.isnan(values)
        for i in np.flatnonzero(was_null[col]):
            lo, hi = max(0, i - IMPUTE_WINDOW_DAYS), min(len(values), i + IMPUTE_WINDOW_DAYS + 1)
            window = values[lo:hi]
            window = window[~np.isnan(window)]
            if len(window):
                values[i] = round(window.mean())
        g[col] = values
    g["is_imputed"] = was_null["count_in"] | was_null["count_out"]

    return g


def _flag_outliers(g: pd.DataFrame) -> pd.DataFrame:
    """One gate's one hour-of-day, one day type (weekend or not), across
    every date it appears. Flags and corrects double-counting outliers
    against a baseline of only its own day type."""
    g = g.sort_values("footfall_date").copy()

    outlier = np.zeros(len(g), dtype=bool)
    for col in ("count_in", "count_out"):
        values = g[col].astype(float)
        rolling_median = values.rolling(window=OUTLIER_WINDOW_ROWS, center=True, min_periods=15).median()
        ratio = values / rolling_median.replace(0, np.nan)
        col_outlier = (ratio > OUTLIER_RATIO_THRESHOLD).fillna(False).to_numpy()
        g.loc[col_outlier, col] = rolling_median[col_outlier].round()
        outlier = outlier | col_outlier
    g["is_outlier_corrected"] = outlier

    return g


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    raw = read_bronze(engine, "bronze.footfall_raw")
    weekend_codes = {code[:3].upper() for code in load_config()["client"]["weekend"]}

    df = pd.DataFrame({
        "sensor_id": raw["sensor_id"],
        "gate_id": raw["sensor_id"],
        "footfall_date": pd.to_datetime(raw["date"]).dt.date,
        "hour": pd.to_numeric(raw["hour"]).astype(int),
        "count_in": pd.to_numeric(raw["count_in"]),
        "count_out": pd.to_numeric(raw["count_out"]),
        "_source_file": raw["_source_file"],
    })
    df["is_weekend"] = pd.to_datetime(df["footfall_date"]).dt.day_name().str[:3].str.upper().isin(weekend_codes)

    resolved_alias = raw["gate_name"].str.strip().map(GATE_NAME_ALIASES)
    dq_flags = [[] for _ in range(len(df))]
    for i, (alias, gate_id) in enumerate(zip(resolved_alias, df["gate_id"])):
        if pd.isna(alias):
            dq_flags[i].append("unrecognized_gate_name")
        elif alias != gate_id:
            dq_flags[i].append("gate_name_conform_mismatch")
    df["_dq_flags"] = dq_flags

    # groupby.apply drops the grouping columns from what the function sees
    # and returns, so the cleaned count/flag columns are pulled back in by
    # the (preserved) original row index rather than trusting the grouped
    # result to carry every column.
    imputed = df.groupby(["gate_id", "hour"], group_keys=False).apply(_impute_gate_hour_series)
    df[["count_in", "count_out", "is_imputed"]] = imputed[["count_in", "count_out", "is_imputed"]]

    flagged = df.groupby(["gate_id", "hour", "is_weekend"], group_keys=False).apply(_flag_outliers)
    df[["count_in", "count_out", "is_outlier_corrected"]] = flagged[
        ["count_in", "count_out", "is_outlier_corrected"]
    ]

    # count_in/count_out are float64 from pd.to_numeric; COPY's CSV parser
    # rejects "4.0" for an INTEGER column (a parameterized INSERT would
    # have coerced it silently, COPY does not), so cast to nullable Int64
    # rather than plain int in case a dead-sensor window ever has no
    # surrounding value to impute from.
    df["count_in"] = df["count_in"].round().astype("Int64")
    df["count_out"] = df["count_out"].round().astype("Int64")

    df = df[[
        "sensor_id", "gate_id", "footfall_date", "hour", "count_in", "count_out",
        "is_imputed", "is_outlier_corrected", "_source_file", "_dq_flags",
    ]]

    return replace_silver_table(engine, "silver.footfall_hourly", df)


if __name__ == "__main__":
    n = transform()
    print(f"footfall_hourly: {n} rows")
