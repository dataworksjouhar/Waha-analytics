"""Gold fact build for fact_tenant_sales: tenant x month x version grain,
versioned transaction fact. The one fact table that has to join against
an SCD Type 2 dimension correctly.

tenant_key cannot be a flat lookup on tenant_id, because dim_tenant carries
more than one surrogate key per tenant_id for a tenant that changed
version (T09: two rows, adjacent non-overlapping date ranges). The correct
key is whichever version was in effect during that sales_month - a
point-in-time join on

    dim_tenant.valid_from <= sales_month <= COALESCE(dim_tenant.valid_to, sales_month)

not a join on tenant_id alone (which would produce two rows per sales row
for a two-version tenant) and not a join on is_current (which would
silently misattribute every historical month before the tenant's latest
change to the wrong version's key).

is_current_version is derived here, not carried over from silver:
submission_version == max(submission_version) for that tenant-month.
Silver's is_restated flags "this row is a restatement," which is exactly
equivalent for this data (no tenant-month is ever submitted more than
twice), but computing it from the max is the correct general rule and
doesn't assume that ceiling holds forever.

join_tenant_version is split out from transform() specifically so
tests/test_fact_tenant_sales.py can exercise the point-in-time join logic
against a small synthetic dim_tenant without a database - the interesting
part of this file is that merge-and-filter, not the I/O around it.

    python -m pipeline.load.fact_tenant_sales
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table


def join_tenant_version(sales: pd.DataFrame, tenants: pd.DataFrame) -> pd.DataFrame:
    """sales: tenant_id, sales_month (both required). tenants: tenant_key,
    tenant_id, valid_from, valid_to (dim_tenant shaped). Returns sales with
    tenant_key attached, keeping only the version whose [valid_from,
    valid_to] window contains that row's sales_month - rows whose
    sales_month matches no version are dropped (a tenant with no dim_tenant
    coverage for that month at all, which should not happen in practice
    but is not this function's job to raise on)."""
    merged = sales.merge(tenants, on="tenant_id", how="left")
    in_range = (merged["sales_month"] >= merged["valid_from"]) & (
        merged["valid_to"].isna() | (merged["sales_month"] <= merged["valid_to"])
    )
    return merged[in_range]


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    silver = read_table(engine, "silver.tenant_sales_monthly")

    with engine.begin() as conn:
        dates = pd.read_sql("SELECT date_key, full_date FROM gold.dim_date", conn)
        tenants = pd.read_sql(
            "SELECT tenant_key, tenant_id, valid_from, valid_to FROM gold.dim_tenant", conn
        )

    silver = silver.copy()
    silver["sales_month"] = pd.to_datetime(silver["sales_month"])
    tenants["valid_from"] = pd.to_datetime(tenants["valid_from"])
    tenants["valid_to"] = pd.to_datetime(tenants["valid_to"])
    dates["full_date"] = pd.to_datetime(dates["full_date"])

    merged = join_tenant_version(silver, tenants)

    unmatched = len(silver) - len(merged)
    if unmatched:
        print(f"  warning: {unmatched} tenant_sales_monthly rows matched no dim_tenant version")

    merged = merged.merge(dates, left_on="sales_month", right_on="full_date", how="left")
    merged["is_current_version"] = merged["submission_version"] == merged.groupby(
        ["tenant_id", "sales_month"]
    )["submission_version"].transform("max")

    df = pd.DataFrame({
        "tenant_key": merged["tenant_key"].astype("Int64"),
        "month_date_key": merged["date_key"].astype("Int64"),
        "submission_version": merged["submission_version"],
        "gross_sales_kwd": merged["gross_sales_kwd"],
        "net_sales_kwd": merged["net_sales_kwd"],
        "submitted_date": merged["submitted_date"],
        "days_late": merged["days_late"],
        "is_restated": merged["is_restated"],
        "is_current_version": merged["is_current_version"],
    })
    return replace_table(engine, "gold.fact_tenant_sales", df)


if __name__ == "__main__":
    n = transform()
    print(f"fact_tenant_sales: {n} rows")
