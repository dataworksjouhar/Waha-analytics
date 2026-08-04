"""Runs every session 10 gold dimension build: dim_date (+ its weather
extension), the seven Type 1 dimensions, dim_customer, dim_member and
dim_tenant (SCD Type 2). Gold facts are session 11, a separate script,
since they read these dimensions' surrogate keys rather than building
alongside them.

Order matters within a run: dim_date before dim_date_weather, and
dim_venue before dim_product, both FK dependencies. dim_date.transform_all
and dim_simple.transform_all already sequence their own pair internally.

spatial_metadata runs last, and must. Every dimension load above it
TRUNCATEs its target and COPYs back only the columns silver supplies, so
the config-sourced spatial columns (zone, gate_label, gate_proximity) are
null for a moment on every rebuild. Applying them at the end of the
dimension pass, before any fact build reads these tables, is what stops a
routine pipeline rerun from silently emptying every zone in the warehouse.

    python -m pipeline.load.run_gold_dims
"""

from __future__ import annotations

import time

from pipeline.db import get_engine
from pipeline.load import (
    dim_customer,
    dim_date,
    dim_member,
    dim_simple,
    dim_tenant,
    spatial_metadata,
)


def run(engine=None) -> None:
    engine = engine or get_engine()

    print("Date:")
    for name, n in dim_date.transform_all(engine).items():
        print(f"  {name}: {n} rows")

    print("Type 1 dimensions:")
    for name, n in dim_simple.transform_all(engine).items():
        print(f"  {name}: {n} rows")

    for label, fn in [
        ("dim_customer", dim_customer.transform),
        ("dim_member", dim_member.transform),
        ("dim_tenant", dim_tenant.transform),
    ]:
        t0 = time.time()
        n = fn(engine)
        print(f"{label}: {n} rows ({time.time() - t0:.1f}s)")

    print("Spatial metadata (from config, not from source files):")
    for table, rows in spatial_metadata.apply(engine).items():
        print(f"  {table}: {rows} rows updated")


if __name__ == "__main__":
    run()
