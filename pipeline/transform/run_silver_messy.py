"""Runs every session 9 silver transform (the messy sources): tenant
submissions, contracts and lessons. Session 8 (structured sources) is a
separate script since those transforms are simpler and were reviewed on
their own.

    python -m pipeline.transform.run_silver_messy
"""

from __future__ import annotations

import time

from pipeline.db import get_engine
from pipeline.transform import contracts, lessons, tenant_sales


def run(engine=None) -> None:
    engine = engine or get_engine()

    for label, fn in [
        ("tenant_sales_monthly", tenant_sales.transform),
        ("contracts", contracts.transform),
        ("lesson_slots", lessons.transform),
    ]:
        t0 = time.time()
        n = fn(engine)
        print(f"{label}: {n} rows ({time.time() - t0:.1f}s)")


if __name__ == "__main__":
    run()
