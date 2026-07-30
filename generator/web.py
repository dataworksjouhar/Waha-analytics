"""Web sessions and bookings generator (Source 4, GA4-flavoured export).

Session volume follows a blended demand index (park + equestrian lessons +
gym seasonality, weighted) split across channel and device. Bookings are
generated per product off that same seasonality family, then each booking is
assigned a channel drawn from that day's channel-mix reweighted by
conversion rate, so paid_social's decaying conversion rate (config) quietly
shrinks its share of bookings even while its session volume stays flat.

Clean data only: no missing channels, no cancellations yet (session 6).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from generator.calendars import seasonality_factor

PRODUCT_NAMES = {
    "playground_ticket": "Playground Ticket",
    "farm_ticket": "Farm Ticket",
    "gym_daypass": "Gym Day Pass",
    "gym_membership": "Gym Membership",
    "event_ticket": "Event Ticket",
    "lesson_package_beginner": "Riding Lesson Package - Beginner",
    "lesson_package_intermediate": "Riding Lesson Package - Intermediate",
    "lesson_package_advanced": "Riding Lesson Package - Advanced",
}
PRODUCT_PRICE_KWD = {
    "playground_ticket": 4.5,
    "farm_ticket": 3.5,
    "gym_daypass": 5.0,
    "gym_membership": 25.0,
    "event_ticket": 5.0,
    "lesson_package_beginner": 60.0,
    "lesson_package_intermediate": 75.0,
    "lesson_package_advanced": 90.0,
}


def _demand_index(dates: pd.Series, config: dict) -> np.ndarray:
    blend = config["web"]["demand_blend"]
    idx = np.zeros(len(dates))
    for profile, weight in blend.items():
        idx += weight * seasonality_factor(dates, profile, config)
    return idx


def _paid_social_conversion(dates: pd.Series, config: dict) -> np.ndarray:
    ps = config["web"]["conversion_rate"]["paid_social"]
    start, end = pd.Timestamp(ps["start_date"]), pd.Timestamp(ps["end_date"])
    span_days = (end - start).days
    elapsed = (dates - start).dt.days.clip(0, span_days)
    return ps["start_rate"] + (ps["end_rate"] - ps["start_rate"]) * (elapsed / span_days)


def build_web_sessions(date_spine: pd.DataFrame, config: dict, rng: np.random.Generator) -> pd.DataFrame:
    wcfg = config["web"]
    dates = date_spine["full_date"]
    demand = _demand_index(dates, config)
    noise = rng.normal(1.0, wcfg["session_noise_std_pct"], size=len(dates))
    total_sessions = wcfg["base_daily_sessions"] * demand * noise

    channels = list(wcfg["channel_mix"].keys())
    devices = list(wcfg["device_mix"].keys())

    rows = []
    for i, date in enumerate(dates.dt.date):
        for channel, ch_share in wcfg["channel_mix"].items():
            for device, dev_share in wcfg["device_mix"].items():
                sessions = max(round(total_sessions[i] * ch_share * dev_share), 0)
                engaged = max(round(sessions * wcfg["engaged_session_rate"] * rng.normal(1.0, 0.05)), 0)
                users = max(round(sessions * rng.uniform(0.82, 0.95)), 0)
                rows.append(
                    {
                        "date": date,
                        "channel": channel,
                        "device": device,
                        "sessions": sessions,
                        "engaged_sessions": min(engaged, sessions),
                        "users": min(users, sessions),
                    }
                )
    return pd.DataFrame(rows)


def build_web_bookings(date_spine: pd.DataFrame, config: dict, rng: np.random.Generator) -> pd.DataFrame:
    """Per day x product, draw a Poisson count then fill that batch's fields
    with vectorized numpy/rng.choice calls (size=n) rather than one rng call
    per booking - at ~120k target rows the per-booking version was too slow."""
    wcfg = config["web"]
    dates = date_spine["full_date"]
    is_weekend = date_spine["is_weekend"].to_numpy()

    channel_names = list(wcfg["channel_mix"].keys())
    channel_session_share = np.array([wcfg["channel_mix"][c] for c in channel_names])
    paid_social_rate = _paid_social_conversion(dates, config)
    static_rates = wcfg["conversion_rate"]

    customer_pool = np.array([f"CUST{n:06d}" for n in range(1, wcfg["customer_pool_size"] + 1)])

    product_factors = {
        code: seasonality_factor(dates, pcfg["profile"], config) for code, pcfg in wcfg["booking_products"].items()
    }

    chunks: list[pd.DataFrame] = []
    booking_counter = 0
    for i, date in enumerate(dates.dt.date):
        # channel weight for the day = session share x that channel's conversion rate,
        # so a channel with more sessions but collapsing conversion loses booking share
        conv_rates = np.array(
            [paid_social_rate[i] if c == "paid_social" else static_rates[c] for c in channel_names]
        )
        channel_weights = channel_session_share * conv_rates
        channel_probs = channel_weights / channel_weights.sum()

        weekend_mult = 1.15 if is_weekend[i] else 1.0

        for product_code, pcfg in wcfg["booking_products"].items():
            expected = pcfg["base_per_day"] * product_factors[product_code][i]
            expected *= weekend_mult if "ticket" in product_code else 1.0
            n = rng.poisson(max(expected, 0))
            if n == 0:
                continue

            booking_ids = np.array([f"BKG{c:08d}" for c in range(booking_counter + 1, booking_counter + 1 + n)])
            booking_counter += n
            qtys = rng.integers(pcfg["qty_range"][0], pcfg["qty_range"][1] + 1, size=n)
            channels = rng.choice(channel_names, size=n, p=channel_probs)
            hours = rng.integers(7, 23, size=n)
            minutes = rng.integers(0, 60, size=n)
            booking_dts = pd.Timestamp(date) + pd.to_timedelta(hours, unit="h") + pd.to_timedelta(minutes, unit="m")

            chunks.append(
                pd.DataFrame(
                    {
                        "booking_id": booking_ids,
                        "booking_datetime": booking_dts,
                        "product_code": product_code,
                        "qty": qtys,
                        "amount_kwd": (qtys * PRODUCT_PRICE_KWD[product_code]).round(3),
                        "channel": channels,
                        "customer_id": rng.choice(customer_pool, size=n),
                    }
                )
            )

    return pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame()
