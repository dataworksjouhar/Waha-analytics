"""Gold-layer test: fact_tenant_sales' point-in-time join against the
SCD Type 2 dim_tenant. This is the one join in the warehouse where getting
it wrong is silent - a plain join on tenant_id would produce two rows per
sale for any two-version tenant, or a join on is_current would misattribute
every pre-change month to the wrong version's key, and neither would error,
just quietly return the wrong tenant_key. See
pipeline/load/fact_tenant_sales.py's docstring.
"""

import pandas as pd

from pipeline.load.fact_tenant_sales import join_tenant_version

# Mirrors the real T09: category changed 2025-06-01, adjacent non-overlapping
# versions.
TWO_VERSION_TENANT = pd.DataFrame({
    "tenant_key": [108, 109],
    "tenant_id": ["T09", "T09"],
    "valid_from": pd.to_datetime(["2023-08-01", "2025-06-01"]),
    "valid_to": pd.to_datetime(["2025-05-31", None]),
})

SINGLE_VERSION_TENANT = pd.DataFrame({
    "tenant_key": [201],
    "tenant_id": ["T01"],
    "valid_from": pd.to_datetime(["2023-08-01"]),
    "valid_to": pd.to_datetime([None]),
})


def test_sale_before_change_resolves_to_first_version():
    sales = pd.DataFrame({"tenant_id": ["T09"], "sales_month": pd.to_datetime(["2025-05-01"])})
    out = join_tenant_version(sales, TWO_VERSION_TENANT)
    assert out["tenant_key"].tolist() == [108]


def test_sale_on_change_month_resolves_to_second_version():
    sales = pd.DataFrame({"tenant_id": ["T09"], "sales_month": pd.to_datetime(["2025-06-01"])})
    out = join_tenant_version(sales, TWO_VERSION_TENANT)
    assert out["tenant_key"].tolist() == [109]


def test_two_version_tenant_never_produces_two_rows_for_one_sale():
    sales = pd.DataFrame({"tenant_id": ["T09"], "sales_month": pd.to_datetime(["2025-05-01"])})
    out = join_tenant_version(sales, TWO_VERSION_TENANT)
    assert len(out) == 1


def test_open_ended_current_version_covers_every_later_month():
    sales = pd.DataFrame({
        "tenant_id": ["T09", "T09"],
        "sales_month": pd.to_datetime(["2025-12-01", "2026-06-01"]),
    })
    out = join_tenant_version(sales, TWO_VERSION_TENANT)
    assert out["tenant_key"].tolist() == [109, 109]


def test_single_version_tenant_resolves_normally():
    sales = pd.DataFrame({"tenant_id": ["T01"], "sales_month": pd.to_datetime(["2024-09-01"])})
    out = join_tenant_version(sales, SINGLE_VERSION_TENANT)
    assert out["tenant_key"].tolist() == [201]
