"""Hourly footfall generator (Source 2, architecture doc section 3).

Daily total = base_daily_visitors x park seasonality x weekend uplift
              x weather suppression x event uplift x daily noise
then split into hours by the Session 2 hourly curve, and across the four
gates by fixed shares plus per-gate noise. Clean data only; session 6 adds
the dead sensor, the double-counting sensor and inconsistent gate names.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from generator.calendars import hourly_weights, seasonality_factor


def _load_events(config: dict) -> pd.DataFrame:
    events = pd.read_csv("data/seeds/events.csv", parse_dates=["start_date", "end_date"])
    return events


def _event_uplift_factor(dates: pd.Series, events: pd.DataFrame, config: dict) -> np.ndarray:
    """Extra visitors per day from any event whose window covers that date,
    summed if events overlap (Ramadan market overlapping National Day, for
    instance, is a real scheduling coincidence, not a data error)."""
    per_attendance = config["footfall"]["event_uplift"]["factor_per_expected_attendance"]
    uplift = np.zeros(len(dates))
    dates_np = dates.to_numpy()
    for _, ev in events.iterrows():
        span_days = max((ev["end_date"] - ev["start_date"]).days + 1, 1)
        daily_expected = ev["expected_attendance"] / span_days
        in_window = (dates_np >= ev["start_date"].to_datetime64()) & (dates_np <= ev["end_date"].to_datetime64())
        uplift[in_window] += daily_expected * per_attendance
    return uplift


def _daily_totals(date_spine: pd.DataFrame, weather: pd.DataFrame, config: dict, rng: np.random.Generator) -> pd.Series:
    fcfg = config["footfall"]
    dates = date_spine["full_date"]

    base = fcfg["base_daily_visitors"] * seasonality_factor(dates, "park", config)

    weekend_mult = np.where(date_spine["is_weekend"], fcfg["weekend_uplift_factor"], 1.0)

    wcfg = fcfg["weather_suppression"]
    is_extreme_heat = weather["temp_max_c"] >= wcfg["extreme_heat_threshold_c"]
    heat_mult = np.where(is_extreme_heat, wcfg["extreme_heat_factor"], 1.0)
    dust_mult = np.where(weather["dust_storm_flag"], wcfg["dust_storm_factor"], 1.0)

    events = _load_events(config)
    event_add = _event_uplift_factor(dates, events, config)

    total = base * weekend_mult * heat_mult * dust_mult + event_add
    noise = rng.normal(1.0, fcfg["noise_std_pct"], size=len(dates))
    total = total * noise
    return pd.Series(np.maximum(total, 0).round().astype(int), index=date_spine.index)


def build_footfall(
    date_spine: pd.DataFrame, weather: pd.DataFrame, config: dict, rng: np.random.Generator
) -> pd.DataFrame:
    """One row per gate x date x hour: sensor_id, gate_name, date, hour, count_in, count_out."""
    fcfg = config["footfall"]
    daily_total = _daily_totals(date_spine, weather, config, rng)

    gates = pd.read_csv("data/seeds/gates.csv")
    gate_shares = fcfg["gate_shares"]

    rows = []
    for date_idx, row in date_spine.iterrows():
        day_total = daily_total.loc[date_idx]
        weights = hourly_weights(config, is_ramadan=bool(row["is_ramadan"]))

        for _, gate in gates.iterrows():
            share = gate_shares[gate["gate_id"]]
            gate_noise = rng.normal(1.0, fcfg["gate_noise_std_pct"])
            gate_total = day_total * share * gate_noise

            for hour, hour_weight in weights.items():
                if hour_weight == 0:
                    continue
                count_in = max(round(gate_total * hour_weight), 0)
                count_out = max(round(count_in * rng.normal(0.97, 0.03)), 0)
                rows.append(
                    {
                        "sensor_id": gate["gate_id"],
                        "gate_name": gate["gate_name"],
                        "date": row["full_date"].date(),
                        "hour": hour,
                        "count_in": count_in,
                        "count_out": count_out,
                    }
                )

    return pd.DataFrame(rows)
