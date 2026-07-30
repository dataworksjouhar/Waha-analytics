import numpy as np
import pandas as pd
import pytest

from generator.calendars import (
    build_date_spine,
    get_rng,
    hourly_weights,
    load_config,
    seasonality_factor,
)


@pytest.fixture(scope="module")
def config():
    return load_config()


@pytest.fixture(scope="module")
def spine(config):
    return build_date_spine(config)


def _factor(config, profile, date_str):
    return seasonality_factor(pd.Series([pd.Timestamp(date_str)]), profile, config)[0]


# ---------------------------------------------------------------------
# Date spine
# ---------------------------------------------------------------------


def test_spine_covers_configured_range_with_no_gaps(config, spine):
    start = pd.Timestamp(config["generator"]["date_range"]["start"])
    end = pd.Timestamp(config["generator"]["date_range"]["end"])
    assert spine["full_date"].min() == start
    assert spine["full_date"].max() == end
    assert len(spine) == (end - start).days + 1
    assert spine["date_key"].is_unique


def test_kuwait_weekend_is_friday_and_saturday_only(spine):
    weekend_days = set(spine.loc[spine["is_weekend"], "day_name"].unique())
    assert weekend_days == {"Friday", "Saturday"}
    weekday_days = set(spine.loc[~spine["is_weekend"], "day_name"].unique())
    assert weekend_days.isdisjoint(weekday_days)


def test_ramadan_flag_matches_configured_periods(config, spine):
    spine_by_date = spine.set_index("full_date")["is_ramadan"]
    for period in config["calendar"]["ramadan_periods"]:
        start, end = pd.Timestamp(period["start"]), pd.Timestamp(period["end"])
        assert spine_by_date.loc[start:end].all()
        day_before = start - pd.Timedelta(days=1)
        day_after = end + pd.Timedelta(days=1)
        if day_before in spine_by_date.index:
            assert not spine_by_date.loc[day_before]
        if day_after in spine_by_date.index:
            assert not spine_by_date.loc[day_after]


def test_national_and_liberation_day_flagged(config, spine):
    spine_by_date = spine.set_index("full_date")
    holidays = {h["date"]: h["name"] for h in config["calendar"]["public_holidays"]}
    for date_str, name in holidays.items():
        row = spine_by_date.loc[pd.Timestamp(date_str)]
        assert row["is_public_holiday"]
        assert row["holiday_name"] == name
    assert holidays["2025-02-25"] == "National Day"
    assert holidays["2025-02-26"] == "Liberation Day"


def test_season_labels_at_representative_dates(spine):
    spine_by_date = spine.set_index("full_date")["season"]
    assert spine_by_date.loc[pd.Timestamp("2025-01-15")] == "winter_peak"
    assert spine_by_date.loc[pd.Timestamp("2025-07-15")] == "summer_trough"
    assert spine_by_date.loc[pd.Timestamp("2025-05-01")] == "shoulder"


# ---------------------------------------------------------------------
# Seasonality profiles
# ---------------------------------------------------------------------


def test_park_peaks_in_winter_and_troughs_in_summer(config):
    winter = _factor(config, "park", "2025-01-15")
    summer = _factor(config, "park", "2025-07-15")
    assert winter > 1.2
    assert summer < 0.5
    assert winter > summer


def test_boarding_is_flat_all_year(config):
    factors = [
        _factor(config, "equestrian_boarding", d)
        for d in ["2025-01-15", "2025-04-15", "2025-07-15", "2025-10-15"]
    ]
    assert max(factors) - min(factors) < 0.01


def test_gym_has_january_intake_spike(config):
    january = _factor(config, "gym", "2025-01-05")
    june = _factor(config, "gym", "2025-06-15")
    assert january > june
    assert january > 1.1


def test_equestrian_lessons_dip_is_shallower_than_park(config):
    park_ratio = _factor(config, "park", "2025-07-15") / _factor(config, "park", "2025-01-15")
    lessons_ratio = _factor(config, "equestrian_lessons", "2025-07-15") / _factor(
        config, "equestrian_lessons", "2025-01-15"
    )
    # a ratio closer to 1.0 means a shallower dip relative to winter
    assert lessons_ratio > park_ratio


# ---------------------------------------------------------------------
# Hourly curve
# ---------------------------------------------------------------------


def test_hourly_weights_are_normalized(config):
    normal = hourly_weights(config, is_ramadan=False)
    ramadan = hourly_weights(config, is_ramadan=True)
    assert len(normal) == 24
    assert len(ramadan) == 24
    assert sum(normal.values()) == pytest.approx(1.0)
    assert sum(ramadan.values()) == pytest.approx(1.0)


def test_ramadan_shifts_peak_hour_later(config):
    normal = hourly_weights(config, is_ramadan=False)
    ramadan = hourly_weights(config, is_ramadan=True)
    normal_peak = max(normal, key=normal.get)
    ramadan_peak = max(ramadan, key=ramadan.get)
    assert ramadan_peak > normal_peak


# ---------------------------------------------------------------------
# Reproducibility
# ---------------------------------------------------------------------


def test_rng_is_deterministic_across_calls(config):
    first = get_rng(config).random(10)
    second = get_rng(config).random(10)
    assert np.array_equal(first, second)
