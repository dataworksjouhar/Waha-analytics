"""Silver-layer test: tenant submissions arrive in three different date
formats depending on tenant (config's tenant_submissions.date_format_style)
and silver has to conform all three without being told which tenant uses
which - see pipeline/transform/tenant_sales.py's docstring.
"""

import pandas as pd

from pipeline.transform.tenant_sales import _parse_mixed_dates


def test_parses_iso_format():
    parsed = _parse_mixed_dates(pd.Series(["2024-07-31"]))
    assert parsed.iloc[0] == pd.Timestamp("2024-07-31")


def test_parses_dmy_slash_format():
    parsed = _parse_mixed_dates(pd.Series(["10/07/2024"]))
    assert parsed.iloc[0] == pd.Timestamp("2024-07-10")


def test_parses_month_name_format():
    parsed = _parse_mixed_dates(pd.Series(["July 2024"]))
    assert parsed.iloc[0] == pd.Timestamp("2024-07-01")


def test_each_row_tries_all_formats_independently():
    # mixed within one Series (never happens per-tenant in the real data,
    # but the function itself makes no per-tenant assumption - it should
    # resolve every row on its own merits)
    mixed = pd.Series(["2024-07-31", "10/07/2024", "July 2024", "not a date"])
    parsed = _parse_mixed_dates(mixed)
    assert parsed.iloc[0] == pd.Timestamp("2024-07-31")
    assert parsed.iloc[1] == pd.Timestamp("2024-07-10")
    assert parsed.iloc[2] == pd.Timestamp("2024-07-01")
    assert pd.isna(parsed.iloc[3])
