"""Tenant monthly sales generator (Source 3). True clean figures only; the
column-name/date-format mess and late/restated submissions are session 6's
job. Each tenant's monthly sales = its calibrated average x that month's
park seasonality (the same driver as footfall) x noise. One tenant reports
a fixed fraction of its true sales every month, planted for the
under-reporting-vs-footfall-share interview story.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from generator.calendars import seasonality_factor


def _month_ends(config: dict) -> pd.DatetimeIndex:
    start = config["generator"]["date_range"]["start"]
    end = config["generator"]["date_range"]["end"]
    return pd.date_range(start=start, end=end, freq="ME")


def build_tenant_sales(config: dict, rng: np.random.Generator) -> pd.DataFrame:
    tcfg = config["tenant_sales"]
    tenants = pd.read_csv("data/seeds/tenants.csv")
    month_ends = _month_ends(config)

    factors = seasonality_factor(pd.Series(month_ends), "park", config)
    avg_factor = factors.mean()

    rows = []
    for _, tenant in tenants.iterrows():
        tenant_id = tenant["tenant_id"]
        if tenant_id not in tcfg["target_avg_monthly_sales_kwd"]:
            continue
        target_avg = tcfg["target_avg_monthly_sales_kwd"][tenant_id]
        lease_start = pd.Timestamp(tenant["lease_start"])
        lease_end = pd.Timestamp(tenant["lease_end"]) if pd.notna(tenant["lease_end"]) else None

        for i, month_end in enumerate(month_ends):
            if month_end < lease_start:
                continue
            if lease_end is not None and month_end > lease_end:
                continue

            noise = rng.normal(1.0, tcfg["monthly_noise_std_pct"])
            true_sales = target_avg * (factors[i] / avg_factor) * noise
            true_sales = max(true_sales, 0)

            if tenant_id == tcfg["under_reporting_tenant"]:
                reported_sales = true_sales * tcfg["under_reporting_factor"]
            else:
                reported_sales = true_sales

            rows.append(
                {
                    "tenant_id": tenant_id,
                    "tenant_name": tenant["tenant_name"],
                    "month": month_end.strftime("%Y-%m"),
                    "gross_sales": round(reported_sales, 3),
                }
            )

    return pd.DataFrame(rows)
