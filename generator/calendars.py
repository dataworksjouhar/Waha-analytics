"""Date spine and seasonality engine.

Every other generator module (footfall, pos, tenants, contracts, lessons)
imports from here for three things: the calendar dimension, a seasonality
multiplier for a given venue pattern, and the seeded random generator. None
of the actual curve shapes or calendar dates are hardcoded below; they all
come from config/client_waha.yml so a future client is a config change.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "client_waha.yml"


def load_config(path: str | Path = CONFIG_PATH) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def get_rng(config: dict) -> np.random.Generator:
    """The one seeded RNG every generator module should share, so the whole
    suite reproduces identical output on re-run."""
    return np.random.default_rng(config["generator"]["seed"])


# ---------------------------------------------------------------------
# Month-day range helper (recurring, not tied to a specific year)
# ---------------------------------------------------------------------


def _md_int(month_day: str) -> int:
    """'10-15' -> 1015. Valid because day <= 31 < 100, so the encoding
    stays monotonic within any real month/day combination."""
    month, day = (int(part) for part in month_day.split("-"))
    return month * 100 + day


def _in_md_range_mask(month: pd.Series, day: pd.Series, start_md: str, end_md: str) -> pd.Series:
    md = month * 100 + day
    start_int, end_int = _md_int(start_md), _md_int(end_md)
    if start_int <= end_int:
        return (md >= start_int) & (md <= end_int)
    # range wraps the year end, e.g. winter_peak "10-15" -> "03-31"
    return (md >= start_int) | (md <= end_int)


# ---------------------------------------------------------------------
# Date spine
# ---------------------------------------------------------------------


def build_date_spine(config: dict) -> pd.DataFrame:
    """One row per calendar day, matching gold.dim_date's columns."""
    start = config["generator"]["date_range"]["start"]
    end = config["generator"]["date_range"]["end"]
    dates = pd.date_range(start=start, end=end, freq="D")

    df = pd.DataFrame({"full_date": dates})
    df["date_key"] = df["full_date"].dt.strftime("%Y%m%d").astype(int)
    df["year"] = df["full_date"].dt.year
    df["quarter"] = df["full_date"].dt.quarter
    df["month"] = df["full_date"].dt.month
    df["month_name"] = df["full_date"].dt.month_name()
    df["day"] = df["full_date"].dt.day
    df["day_of_week"] = df["full_date"].dt.dayofweek + 1  # ISO: 1=Mon .. 7=Sun
    df["day_name"] = df["full_date"].dt.day_name()

    weekend_codes = {code[:3].upper() for code in config["client"]["weekend"]}
    df["is_weekend"] = df["day_name"].str[:3].str.upper().isin(weekend_codes)

    df["is_ramadan"] = _ramadan_mask(df["full_date"], config)

    holiday_name = _public_holiday_names(df["full_date"], config)
    df["holiday_name"] = holiday_name
    df["is_public_holiday"] = holiday_name.notna()

    df["season"] = _season_labels(df["month"], df["day"], config)

    return df[
        [
            "date_key",
            "full_date",
            "year",
            "quarter",
            "month",
            "month_name",
            "day",
            "day_of_week",
            "day_name",
            "is_weekend",
            "is_ramadan",
            "is_public_holiday",
            "holiday_name",
            "season",
        ]
    ]


def _ramadan_mask(full_date: pd.Series, config: dict) -> pd.Series:
    mask = pd.Series(False, index=full_date.index)
    for period in config["calendar"]["ramadan_periods"]:
        start, end = pd.Timestamp(period["start"]), pd.Timestamp(period["end"])
        mask |= (full_date >= start) & (full_date <= end)
    return mask


def _public_holiday_names(full_date: pd.Series, config: dict) -> pd.Series:
    holiday_map = {
        pd.Timestamp(h["date"]): h["name"] for h in config["calendar"]["public_holidays"]
    }
    return full_date.map(holiday_map)


def _season_labels(month: pd.Series, day: pd.Series, config: dict) -> pd.Series:
    boundaries = config["calendar"]["season_boundaries"]
    winter_mask = _in_md_range_mask(month, day, boundaries["winter_peak"]["start"], boundaries["winter_peak"]["end"])
    summer_mask = _in_md_range_mask(month, day, boundaries["summer_trough"]["start"], boundaries["summer_trough"]["end"])
    return pd.Series(
        np.select([winter_mask, summer_mask], ["winter_peak", "summer_trough"], default="shoulder"),
        index=month.index,
    )


# ---------------------------------------------------------------------
# Seasonality factor (per venue profile)
# ---------------------------------------------------------------------


def _day_fraction(dates: pd.Series) -> np.ndarray:
    """Position of each date within its year, as a fraction in [0, 1)."""
    year_start = pd.to_datetime(dates.dt.year.astype(str) + "-01-01")
    days_in_year = np.where(dates.dt.is_leap_year, 366, 365)
    return ((dates - year_start).dt.days / days_in_year).to_numpy()


def _anchor_day_fraction(month_day: str) -> float:
    month, day = (int(part) for part in month_day.split("-"))
    day_of_year = dt.date(2001, month, day).timetuple().tm_yday  # fixed non-leap reference year
    return (day_of_year - 1) / 365.0


def _cyclic_interp(query_fracs: np.ndarray, anchor_fracs: np.ndarray, anchor_factors: np.ndarray) -> np.ndarray:
    order = np.argsort(anchor_fracs)
    af = anchor_fracs[order]
    avals = anchor_factors[order]
    # pad one anchor before and after so np.interp wraps across the year
    # boundary instead of clamping at the first/last anchor
    ext_fracs = np.concatenate([af[-1:] - 1.0, af, af[:1] + 1.0])
    ext_vals = np.concatenate([avals[-1:], avals, avals[:1]])
    return np.interp(query_fracs, ext_fracs, ext_vals)


def seasonality_factor(dates: pd.Series, profile: str, config: dict) -> np.ndarray:
    """Vectorized seasonality multiplier for every date in `dates`, for the
    given profile name (park, equestrian_lessons, equestrian_boarding, gym)."""
    anchors = config["seasonality"]["profiles"][profile]["anchors"]
    anchor_fracs = np.array([_anchor_day_fraction(a["date"]) for a in anchors])
    anchor_factors = np.array([a["factor"] for a in anchors])
    query_fracs = _day_fraction(dates)
    return _cyclic_interp(query_fracs, anchor_fracs, anchor_factors)


# ---------------------------------------------------------------------
# Hourly curve
# ---------------------------------------------------------------------


def hourly_weights(config: dict, is_ramadan: bool) -> dict[int, float]:
    """Normalized hour (0-23) -> share of the day's total, so callers can
    multiply a daily total by these weights to get an hourly series."""
    shape = "ramadan" if is_ramadan else "normal"
    raw = config["seasonality"]["hourly_weights"][shape]
    total = sum(raw.values())
    return {hour: weight / total for hour, weight in raw.items()}
