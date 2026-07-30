"""Riding lesson schedule and attendance generator (Source 8). Fixed daily
slot counts per level; booked count = capacity x target_utilization x
equestrian_lessons seasonality x noise. The per-level target_utilization
values (config) are the planted insight itself, not just seasonal noise:
beginner runs near capacity and advanced sits half-empty in every month of
the year, which is what makes it a scheduling/pricing fix rather than a
one-off blip. Clean data only; missing attendance and overbooking are
session 6.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from generator.calendars import seasonality_factor


def build_lessons(date_spine: pd.DataFrame, config: dict, rng: np.random.Generator) -> pd.DataFrame:
    lcfg = config["lessons"]
    horses = pd.read_csv("data/seeds/horses.csv")
    start_times = lcfg["start_times"]

    eq_factor = seasonality_factor(date_spine["full_date"], "equestrian_lessons", config)

    rows = []
    lesson_counter = 0
    for i, day in date_spine.iterrows():
        date = day["full_date"].date()
        for level, lvl_cfg in lcfg["levels"].items():
            level_horses = horses[horses["level_suitability"].str.contains(level, case=False)]["horse_id"].tolist()
            if not level_horses:
                level_horses = horses[horses["level_suitability"] == "all_levels"]["horse_id"].tolist()

            for slot_idx in range(lvl_cfg["slots_per_day"]):
                lesson_counter += 1
                capacity = lvl_cfg["capacity"]
                noise = rng.normal(1.0, lcfg["utilization_noise_std_pct"])
                booked_raw = capacity * lvl_cfg["target_utilization"] * eq_factor[i] * noise
                booked = int(np.clip(round(booked_raw), 0, capacity))
                attended = int(np.clip(round(booked * (1 - lcfg["no_show_rate"]) * rng.normal(1.0, 0.05)), 0, booked))

                n_horses = min(max(booked, 1), len(level_horses)) if level_horses else 0
                horse_ids = rng.choice(level_horses, size=n_horses, replace=False).tolist() if n_horses else []

                rows.append(
                    {
                        "lesson_id": f"LSN{lesson_counter:08d}",
                        "lesson_date": date,
                        "start_time": start_times[slot_idx % len(start_times)],
                        "instructor_id": lvl_cfg["instructor_id"],
                        "level": level,
                        "capacity": capacity,
                        "booked": booked,
                        "attended": attended,
                        "horse_ids": ",".join(horse_ids),
                    }
                )

    return pd.DataFrame(rows)
