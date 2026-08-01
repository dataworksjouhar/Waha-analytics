"""Silver transform for Source 3 (tenant monthly sales submissions), the
showcase mess. Bronze already parsed tenant_id/sales_month/is_restatement
from the filename and pulled whatever gross_sales/net_sales/date columns
existed in each tenant's own layout (see the tenant_sales reader in
pipeline/extract/bronze_extract.py); silver's job is everything downstream
of that: mixed date formats, weekly-versus-monthly rows collapsed to one
tenant-month figure, and the days_late/version bookkeeping that feeds
turnover rent and the compliance metric.

Grain is tenant_id x sales_month x submission_version, matching the
UNIQUE constraint on silver.tenant_sales_monthly. In the real data no
tenant-month is ever submitted more than twice (an original, plus for
about one in ten a single restatement), so submission_version is 2
exactly when bronze's is_restatement flag is set - no general
version-ranking logic is needed. Both versions are kept; which one is
"current" is a gold-layer concern (fact_tenant_sales.is_current_version,
session 11), not silver's.

    python -m pipeline.transform.tenant_sales
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.transform.util import read_bronze, replace_silver_table


def _parse_mixed_dates(raw: pd.Series) -> pd.Series:
    """Tenant files use one of three date styles depending on tenant
    (config/client_waha.yml's tenant_submissions.date_format_style: iso,
    dmy_slash or month_name - e.g. "2024-07-31", "10/07/2024" or "July
    2024"), and never mix styles within one tenant, but silver doesn't
    know or care which tenant is which - it tries each format in turn and
    keeps whichever one parses, rather than hardcoding a format per
    tenant_id."""
    parsed = pd.to_datetime(raw, format="%Y-%m-%d", errors="coerce")
    for fmt in ("%d/%m/%Y", "%B %Y"):
        remaining = parsed.isna()
        parsed = parsed.fillna(pd.to_datetime(raw[remaining], format=fmt, errors="coerce"))
    return parsed


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    raw = read_bronze(engine, "bronze.tenant_sales_raw")

    raw["parsed_date"] = _parse_mixed_dates(raw["date_raw"])
    raw["gross_sales"] = pd.to_numeric(raw["gross_sales_raw"], errors="coerce")
    raw["net_sales"] = pd.to_numeric(raw["net_sales_raw"], errors="coerce")

    # Sum across rows within a tenant-month-version (only T03 ever has
    # more than one, reporting weekly). min_count=1 matters here: a
    # gross-only tenant's net_sales column is entirely NaN for that
    # group, and sum() with the default min_count=0 would turn that into
    # 0.0 rather than "not reported" - a real 0 KWD month looks nothing
    # like a tenant that simply doesn't report net sales at all.
    grouped = raw.groupby(["tenant_id", "sales_month", "is_restatement"], as_index=False).agg(
        gross_sales_kwd=("gross_sales", lambda s: s.sum(min_count=1)),
        net_sales_kwd=("net_sales", lambda s: s.sum(min_count=1)),
        submitted_date=("submitted_date", "first"),
        _source_file=("_source_file", "first"),
        unparsed_dates=("parsed_date", lambda s: int(s.isna().sum())),
    )

    sales_month = pd.to_datetime(grouped["sales_month"], format="%Y-%m")
    month_end = sales_month + pd.offsets.MonthEnd(0)
    submitted_date = pd.to_datetime(grouped["submitted_date"])

    df = pd.DataFrame({
        "tenant_id": grouped["tenant_id"],
        "sales_month": sales_month.dt.date,
        "gross_sales_kwd": grouped["gross_sales_kwd"],
        "net_sales_kwd": grouped["net_sales_kwd"],
        "submitted_date": submitted_date.dt.date,
        "submission_version": grouped["is_restatement"].map({True: 2, False: 1}),
        "days_late": (submitted_date - month_end).dt.days,
        "is_restated": grouped["is_restatement"],
        "_source_file": grouped["_source_file"],
    })

    no_sales_reported = df["gross_sales_kwd"].isna() & df["net_sales_kwd"].isna()
    dq_flags = [[] for _ in range(len(df))]
    for i, (unparsed, no_sales) in enumerate(zip(grouped["unparsed_dates"], no_sales_reported)):
        if unparsed:
            dq_flags[i].append("unparsed_date")
        if no_sales:
            dq_flags[i].append("no_sales_reported")
    df["_dq_flags"] = dq_flags

    return replace_silver_table(engine, "silver.tenant_sales_monthly", df)


if __name__ == "__main__":
    n = transform()
    print(f"tenant_sales_monthly: {n} rows")
