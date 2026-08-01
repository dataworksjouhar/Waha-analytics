"""Gold dimension build for dim_tenant: the one SCD Type 2 dimension in
this warehouse.

This is a direct mapping, not a change-detection merge. silver.tenants
already carries one row per tenant *version*, with effective_start_date
and effective_end_date coming straight from the source master file
(tenants.csv already encodes when each version of a tenant's record was
true). Because the whole pipeline rebuilds gold from silver on every run
rather than merging incrementally, there is no "compare the incoming row
against what's already in the dimension" step to write: valid_from,
valid_to and is_current fall straight out of the source's own version
boundaries.

    valid_from  = effective_start_date
    valid_to    = effective_end_date
    is_current  = effective_end_date IS NULL

Two things worth being precise about, checked against the real data
rather than assumed from the architecture doc's framing:

- T09 is the genuine two-version case: category changes from "Retail -
  Specialty" to "Retail - Fashion" on 2025-06-01, with adjacent,
  non-overlapping date ranges (version 1 ends 2025-05-31, version 2
  starts 2025-06-01).
- T04 ("closes mid-history" in the architecture doc) is actually a
  single-version row: status='closed', lease_end populated, but
  effective_end_date is null. The source only gives us its final closed
  state, not a history of active-then-closed. is_current=true for that
  one row is still correct: is_current means "the latest known version
  of this tenant's record," not "this tenant is operationally active."
  A query for currently-operating tenants filters on status='active' in
  addition to is_current, not instead of it.

How a true incremental SCD2 merge would handle a late-arriving change
(this system does not need to, since it always rebuilds from a source
that already has the full version history, but it is worth being able to
explain): a late-arriving change is a correction to a historical
attribute that shows up after newer versions have already been recorded
downstream - e.g. discovering in 2026 that a tenant's category actually
changed on 2025-03-01, when dim_tenant already has a version covering
that whole period plus a further version after it. Handling it correctly
means finding which existing version's [valid_from, valid_to) window
contains the newly-known effective date, splitting that window in two
(the original version now ends the day before the new effective date,
the late-arriving version covers from the new effective date to whatever
the next version already starts), and - the genuinely hard part -
re-pointing any fact rows from that period that already joined to the
old version's surrogate key, since a surrogate key baked into a fact
table does not update itself just because the dimension gained a new
version underneath it.

    python -m pipeline.load.dim_tenant
"""

from __future__ import annotations

import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    silver = read_table(engine, "silver.tenants")

    df = silver[[
        "tenant_id", "tenant_name", "category", "unit_no", "unit_sqm",
        "lease_start", "lease_end", "base_rent_kwd", "turnover_rent_pct",
        "turnover_threshold_kwd", "status",
    ]].copy()
    df["valid_from"] = silver["effective_start_date"]
    df["valid_to"] = silver["effective_end_date"]
    df["is_current"] = silver["effective_end_date"].isna()

    return replace_table(engine, "gold.dim_tenant", df, cascade=True)


if __name__ == "__main__":
    n = transform()
    print(f"dim_tenant: {n} rows")
