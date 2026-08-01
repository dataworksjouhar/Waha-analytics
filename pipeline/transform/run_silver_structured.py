"""Runs every session 8 silver transform (structured sources plus the
clean master data): master data, weather, events, POS sales, footfall,
web sessions and bookings. Session 9 (tenant submissions, contracts,
lessons) is a separate script since those transforms are messier and
reviewed on their own.

    python -m pipeline.transform.run_silver_structured
"""

from __future__ import annotations

import time

from pipeline.db import get_engine
from pipeline.transform import events, footfall, master_data, pos_sales, weather, web


def run() -> None:
    engine = get_engine()

    print("Master data:")
    for name, n in master_data.transform_all(engine).items():
        print(f"  {name}: {n} rows")

    for label, fn in [
        ("weather_daily", weather.transform),
        ("events", events.transform),
        ("pos_sales_lines", pos_sales.transform),
        ("footfall_hourly", footfall.transform),
    ]:
        t0 = time.time()
        n = fn(engine)
        print(f"{label}: {n} rows ({time.time() - t0:.1f}s)")

    print("Web:")
    for name, n in web.transform_all(engine).items():
        print(f"  {name}: {n} rows")


if __name__ == "__main__":
    run()
