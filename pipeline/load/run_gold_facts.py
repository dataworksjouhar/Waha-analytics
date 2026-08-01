"""Runs every session 11 gold fact build, in an order that doesn't matter
functionally (facts don't reference each other) but is kept in the same
order as the architecture doc's fact table list for readability.

Every fact here does its own dimension surrogate-key lookups against
whatever is currently in gold, so this must run after run_gold_dims - see
run_gold.py, which is the actual entry point once facts exist (see that
module's docstring for why dims can no longer be reloaded alone).

    python -m pipeline.load.run_gold_facts
"""

from __future__ import annotations

import time

from pipeline.db import get_engine
from pipeline.load import (
    fact_bookings,
    fact_footfall,
    fact_lesson_slots,
    fact_membership_months,
    fact_pos_sales,
    fact_tenant_sales,
    fact_web_sessions,
)


def run(engine=None) -> dict[str, int]:
    engine = engine or get_engine()
    results = {}
    for label, fn in [
        ("fact_pos_sales", fact_pos_sales.transform),
        ("fact_footfall", fact_footfall.transform),
        ("fact_tenant_sales", fact_tenant_sales.transform),
        ("fact_bookings", fact_bookings.transform),
        ("fact_web_sessions", fact_web_sessions.transform),
        ("fact_membership_months", fact_membership_months.transform),
        ("fact_lesson_slots", fact_lesson_slots.transform),
    ]:
        t0 = time.time()
        n = fn(engine)
        results[label] = n
        print(f"{label}: {n} rows ({time.time() - t0:.1f}s)")
    return results


if __name__ == "__main__":
    run()
