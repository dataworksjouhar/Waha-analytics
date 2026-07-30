"""Daily weather generator (Source 6, architecture doc section 3).

Clean by design, no imperfection toggles: real external weather APIs don't
arrive corrupted the way an internal spreadsheet does. Reuses the same
cyclic-anchor interpolation as calendars.seasonality_factor so the annual
temperature curve lives in config, not in a hardcoded Python formula.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from generator.calendars import _anchor_day_fraction, _cyclic_interp, _day_fraction, _in_md_range_mask


def _temp_curve(dates: pd.Series, anchors: list[dict], rng: np.random.Generator, noise_c: float) -> np.ndarray:
    anchor_fracs = np.array([_anchor_day_fraction(a["date"]) for a in anchors])
    anchor_temps = np.array([a["temp_c"] for a in anchors])
    query_fracs = _day_fraction(dates)
    base = _cyclic_interp(query_fracs, anchor_fracs, anchor_temps)
    return base + rng.normal(0.0, noise_c, size=len(dates))


def build_weather(date_spine: pd.DataFrame, config: dict, rng: np.random.Generator) -> pd.DataFrame:
    """One row per day: temp_max_c, temp_min_c, dust_storm_flag, rain_mm."""
    wcfg = config["weather"]
    dates = date_spine["full_date"]
    month, day = date_spine["month"], date_spine["day"]

    temp_max = _temp_curve(dates, wcfg["temp_max_anchors"], rng, wcfg["daily_noise_c"])
    temp_min = _temp_curve(dates, wcfg["temp_min_anchors"], rng, wcfg["daily_noise_c"])
    # min can't exceed max after independent noise draws; clip with a small gap
    temp_min = np.minimum(temp_min, temp_max - 2.0)

    dust_cfg = wcfg["dust_storm"]
    in_dust_season = _in_md_range_mask(month, day, dust_cfg["season"]["start"], dust_cfg["season"]["end"])
    dust_prob = np.where(in_dust_season, dust_cfg["probability_in_season"], dust_cfg["probability_out_of_season"])
    dust_storm_flag = rng.random(len(dates)) < dust_prob

    rain_cfg = wcfg["rain"]
    in_rain_season = _in_md_range_mask(month, day, rain_cfg["season"]["start"], rain_cfg["season"]["end"])
    rain_prob = np.where(in_rain_season, rain_cfg["probability_in_season"], rain_cfg["probability_out_of_season"])
    rains = rng.random(len(dates)) < rain_prob
    low, high = rain_cfg["amount_mm_range"]
    rain_mm = np.where(rains, rng.uniform(low, high, size=len(dates)), 0.0)

    return pd.DataFrame(
        {
            "date": dates,
            "temp_max_c": temp_max.round(1),
            "temp_min_c": temp_min.round(1),
            "dust_storm_flag": dust_storm_flag,
            "rain_mm": rain_mm.round(1),
        }
    )
