"""Deliberate imperfection injection (architecture doc section 3). Each
function takes a clean DataFrame from sessions 3-5 and returns a messy one;
none of them change the TRUE underlying numbers, only how those numbers
arrive - late, mislabeled, duplicated, or missing - which is exactly what a
real source system does. Every mess is behind config so generate.py can
produce clean data (for testing transforms) or messy data (for the demo).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------
# Source 2: footfall
# ---------------------------------------------------------------------


def inject_footfall_mess(footfall: pd.DataFrame, config: dict, rng: np.random.Generator) -> pd.DataFrame:
    mcfg = config["mess"]["footfall"]
    df = footfall.copy()
    df["date"] = pd.to_datetime(df["date"])

    dead = mcfg["dead_sensor"]
    dead_start = pd.Timestamp(dead["start_date"])
    dead_end = dead_start + pd.Timedelta(hours=dead["hours"])
    dead_mask = (df["sensor_id"] == dead["gate_id"]) & (
        (df["date"] + pd.to_timedelta(df["hour"], unit="h")) >= dead_start
    ) & ((df["date"] + pd.to_timedelta(df["hour"], unit="h")) < dead_end)
    df.loc[dead_mask, ["count_in", "count_out"]] = np.nan

    dbl = mcfg["double_counting_sensor"]
    dbl_mask = (
        (df["sensor_id"] == dbl["gate_id"])
        & (df["date"] >= pd.Timestamp(dbl["start_date"]))
        & (df["date"] <= pd.Timestamp(dbl["end_date"]))
    )
    df.loc[dbl_mask, "count_in"] = (df.loc[dbl_mask, "count_in"] * dbl["multiplier"]).round()
    df.loc[dbl_mask, "count_out"] = (df.loc[dbl_mask, "count_out"] * dbl["multiplier"]).round()

    # Gate naming convention rotates day to day (inconsistent across files),
    # not within a single day's file.
    styles = list(mcfg["gate_name_styles"].keys())
    unique_dates = df["date"].dt.date.unique()
    style_by_date = {d: styles[rng.integers(0, len(styles))] for d in unique_dates}
    df["gate_name"] = df.apply(
        lambda r: mcfg["gate_name_styles"][style_by_date[r["date"].date()]][r["sensor_id"]], axis=1
    )
    df["date"] = df["date"].dt.date
    return df


# ---------------------------------------------------------------------
# Source 1: POS sales
# ---------------------------------------------------------------------


def inject_pos_mess(pos: pd.DataFrame, config: dict, rng: np.random.Generator) -> pd.DataFrame:
    mcfg = config["mess"]["pos"]
    df = pos.copy()

    n = len(df)
    dup_mask = rng.random(n) < mcfg["duplicate_line_rate"]
    duplicates = df.loc[dup_mask].copy()

    refund_mask = rng.random(n) < mcfg["refund_rate"]
    refunds = df.loc[refund_mask].copy()
    delay_lo, delay_hi = mcfg["refund_delay_days_range"]
    delays = rng.integers(delay_lo, delay_hi + 1, size=len(refunds))
    refunds["QTY"] = -refunds["QTY"]
    refunds["LINEAMOUNT"] = -refunds["LINEAMOUNT"]
    refunds["INVOICEID"] = refunds["INVOICEID"] + "R"
    refunds["SALESID"] = refunds["SALESID"] + "R"
    refunds["CREATEDDATETIME"] = pd.to_datetime(refunds["CREATEDDATETIME"]) + pd.to_timedelta(delays, unit="D")
    refunds["INVOICEDATE"] = refunds["CREATEDDATETIME"].dt.date

    return pd.concat([df, duplicates, refunds], ignore_index=True)


# ---------------------------------------------------------------------
# Source 4: web bookings
# ---------------------------------------------------------------------


def inject_web_bookings_mess(bookings: pd.DataFrame, config: dict, rng: np.random.Generator) -> pd.DataFrame:
    mcfg = config["mess"]["web_bookings"]
    df = bookings.copy()
    n = len(df)

    missing_mask = rng.random(n) < mcfg["missing_channel_rate"]
    df.loc[missing_mask, "channel"] = None

    cancel_mask = rng.random(n) < mcfg["cancellation_rate"]
    cancellations = df.loc[cancel_mask].copy()
    delay_lo, delay_hi = mcfg["cancellation_delay_days_range"]
    delays = rng.integers(delay_lo, delay_hi + 1, size=len(cancellations))
    cancellations["qty"] = -cancellations["qty"]
    cancellations["amount_kwd"] = -cancellations["amount_kwd"]
    cancellations["booking_id"] = cancellations["booking_id"] + "C"
    cancellations["booking_datetime"] = pd.to_datetime(cancellations["booking_datetime"]) + pd.to_timedelta(
        delays, unit="D"
    )

    return pd.concat([df, cancellations], ignore_index=True)


# ---------------------------------------------------------------------
# Source 5: events
# ---------------------------------------------------------------------


def inject_events_mess(events: pd.DataFrame, config: dict) -> pd.DataFrame:
    df = events.copy()
    bad_id = config["mess"]["events"]["bad_range_event_id"]
    mask = df["event_id"] == bad_id
    df.loc[mask, ["start_date", "end_date"]] = df.loc[mask, ["end_date", "start_date"]].values
    return df


# ---------------------------------------------------------------------
# Source 3: tenant monthly sales -> per tenant-month submission records,
# since the mess here is fundamentally about file shape (columns, date
# format, monthly vs weekly grain) and arrival timing, not just values.
# ---------------------------------------------------------------------


def _format_date(d: pd.Timestamp, style: str) -> str:
    if style == "iso":
        return d.strftime("%Y-%m-%d")
    if style == "dmy_slash":
        return d.strftime("%d/%m/%Y")
    if style == "month_name":
        return d.strftime("%B %Y")
    raise ValueError(f"unknown date format style: {style}")


def build_tenant_submission_records(tenant_sales: pd.DataFrame, config: dict, rng: np.random.Generator) -> list[dict]:
    mcfg = config["mess"]["tenant_submissions"]
    records = []

    for _, row in tenant_sales.iterrows():
        tenant_id = row["tenant_id"]
        month_end = pd.Timestamp(row["month"] + "-01") + pd.offsets.MonthEnd(0)
        gross = row["gross_sales"]
        col_style = mcfg["column_style"][tenant_id]
        date_style = mcfg["date_format_style"][tenant_id]
        is_weekly = tenant_id == mcfg["weekly_reporter"]

        late_lo, late_hi = mcfg["late_days_range"]
        submitted_date = month_end + pd.Timedelta(days=int(rng.integers(late_lo, late_hi + 1)))

        def make_rows(period_end: pd.Timestamp, amount: float) -> dict:
            record = {"date": _format_date(period_end, date_style)}
            if col_style in ("gross_only", "both"):
                record["gross_sales"] = round(amount, 3)
            if col_style in ("net_only", "both"):
                record["net_sales"] = round(amount * mcfg["net_sales_factor"], 3)
            return record

        if is_weekly:
            n_weeks = 4
            week_shares = rng.dirichlet(np.ones(n_weeks))
            week_ends = [month_end - pd.Timedelta(weeks=n_weeks - 1 - i) for i in range(n_weeks)]
            rows = [make_rows(we, gross * share) for we, share in zip(week_ends, week_shares)]
        else:
            rows = [make_rows(month_end, gross)]

        records.append(
            {
                "tenant_id": tenant_id,
                "month": row["month"],
                "filename": f"tenant_sales_{tenant_id.lower()}_{row['month']}.csv",
                "dataframe": pd.DataFrame(rows),
                "submitted_date": submitted_date,
                "is_restatement": False,
            }
        )

        if rng.random() < mcfg["restatement_rate"]:
            extra_lo, extra_hi = mcfg["restatement_extra_days_range"]
            restated_amount = gross * rng.uniform(0.90, 1.10)
            restated_date = submitted_date + pd.Timedelta(days=int(rng.integers(extra_lo, extra_hi + 1)))
            if is_weekly:
                week_shares = rng.dirichlet(np.ones(n_weeks))
                rows = [make_rows(we, restated_amount * share) for we, share in zip(week_ends, week_shares)]
            else:
                rows = [make_rows(month_end, restated_amount)]
            records.append(
                {
                    "tenant_id": tenant_id,
                    "month": row["month"],
                    "filename": f"tenant_sales_{tenant_id.lower()}_{row['month']}_restated.csv",
                    "dataframe": pd.DataFrame(rows),
                    "submitted_date": restated_date,
                    "is_restatement": True,
                }
            )

    return records


# ---------------------------------------------------------------------
# Source 7: contracts
# ---------------------------------------------------------------------


def inject_contracts_mess(contracts: pd.DataFrame, config: dict, rng: np.random.Generator) -> pd.DataFrame:
    mcfg = config["mess"]["contracts"]
    df = contracts.copy()

    member_ids = df["member_id"].unique()
    phones = {m: f"+965 {rng.integers(5, 10)}{rng.integers(0, 10**7):07d}" for m in member_ids}
    df["phone_number"] = df["member_id"].map(phones)

    gym_members = df.loc[df["contract_type"].isin(["gym_monthly", "gym_annual"]), "member_id"].unique()
    equestrian_members = df.loc[df["contract_type"] == "equestrian_club", "member_id"].unique()
    n_dup = min(mcfg["duplicate_identity_count"], len(gym_members), len(equestrian_members))
    gym_pick = rng.choice(gym_members, size=n_dup, replace=False)
    equestrian_pick = rng.choice(equestrian_members, size=n_dup, replace=False)
    for gym_member, eq_member in zip(gym_pick, equestrian_pick):
        df.loc[df["member_id"] == eq_member, "phone_number"] = phones[gym_member]

    cancelled = df["status"] == "cancelled"
    bad_mask = cancelled & (rng.random(len(df)) < mcfg["bad_cancellation_rate"])
    start_dates = pd.to_datetime(df.loc[bad_mask, "start_date"])
    bad_offsets = rng.integers(1, 31, size=bad_mask.sum())
    df.loc[bad_mask, "cancellation_date"] = (start_dates - pd.to_timedelta(bad_offsets, unit="D")).dt.date

    return df


# ---------------------------------------------------------------------
# Source 8: lessons
# ---------------------------------------------------------------------


def inject_lessons_mess(lessons: pd.DataFrame, config: dict, rng: np.random.Generator) -> pd.DataFrame:
    mcfg = config["mess"]["lessons"]
    df = lessons.copy()
    n = len(df)

    missing_mask = rng.random(n) < mcfg["missing_attended_rate"]
    df.loc[missing_mask, "attended"] = np.nan

    over_mask = rng.random(n) < mcfg["overbooking_rate"]
    extra_lo, extra_hi = mcfg["overbooking_extra_range"]
    extra = rng.integers(extra_lo, extra_hi + 1, size=over_mask.sum())
    df.loc[over_mask, "booked"] = df.loc[over_mask, "capacity"] + extra

    return df
