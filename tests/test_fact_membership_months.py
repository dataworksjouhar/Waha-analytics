"""Gold-layer test: fact_membership_months' reconstruction of monthly
history from silver.contracts' single latest-snapshot row per contract.
Covers the four rules in pipeline/load/fact_membership_months.py's
docstring: window clamping at both ends, is_new/is_churned only firing on
a contract's true boundary (not the window's), and the same-month
is_new-and-is_churned case.
"""

import pandas as pd

from pipeline.load.fact_membership_months import explode_contract_months

MIN_MONTH = pd.Timestamp("2024-07-01")
MAX_MONTH = pd.Timestamp("2026-07-01")


def _contract(**kwargs):
    row = {
        "contract_id": "C1",
        "start_date": "2025-01-15",
        "end_date": None,
        "status": "active",
        "monthly_amount_kwd": 25.0,
    }
    row.update(kwargs)
    return pd.DataFrame([row])


def test_open_ended_contract_runs_to_window_end_without_churning():
    out = explode_contract_months(_contract(), MIN_MONTH, MAX_MONTH)
    assert out["month_date"].min() == pd.Timestamp("2025-01-01")
    assert out["month_date"].max() == MAX_MONTH
    assert not out["is_churned"].any()
    assert out.loc[out["month_date"] == pd.Timestamp("2025-01-01"), "is_new"].iloc[0]


def test_cancelled_contract_churns_on_its_end_month_only():
    out = explode_contract_months(
        _contract(end_date="2025-04-20", status="cancelled"), MIN_MONTH, MAX_MONTH
    )
    assert out["month_date"].max() == pd.Timestamp("2025-04-01")
    churned_rows = out[out["is_churned"]]
    assert len(churned_rows) == 1
    assert churned_rows["month_date"].iloc[0] == pd.Timestamp("2025-04-01")
    assert churned_rows["month_status"].iloc[0] == "cancelled"


def test_founding_member_predating_window_is_not_flagged_new():
    # mirrors the real CTR001798: started 2023-07-17, before the window
    # opens - it still generates rows from the window's first month, but
    # is_new must never fire, since it wasn't actually acquired then.
    out = explode_contract_months(
        _contract(start_date="2023-07-17", end_date="2024-07-16", status="expired"),
        MIN_MONTH,
        MAX_MONTH,
    )
    assert len(out) == 1
    assert out["month_date"].iloc[0] == MIN_MONTH
    assert not out["is_new"].iloc[0]
    assert out["is_churned"].iloc[0]


def test_contract_starting_and_ending_same_month_is_both_new_and_churned():
    out = explode_contract_months(
        _contract(start_date="2025-03-05", end_date="2025-03-20", status="cancelled"),
        MIN_MONTH,
        MAX_MONTH,
    )
    assert len(out) == 1
    assert out["is_new"].iloc[0]
    assert out["is_churned"].iloc[0]


def test_active_contract_with_future_end_date_is_capped_not_churned():
    # status='active' but end_date already set (a fixed term not yet
    # finished) - 125 real contracts look like this. Must generate up to
    # the window edge, not the (still-future) end_date, and never churn.
    out = explode_contract_months(
        _contract(start_date="2026-01-01", end_date="2027-01-01", status="active"),
        MIN_MONTH,
        MAX_MONTH,
    )
    assert out["month_date"].max() == MAX_MONTH
    assert not out["is_churned"].any()


def test_mrr_is_full_monthly_amount_every_month_no_proration():
    out = explode_contract_months(_contract(monthly_amount_kwd=40.0), MIN_MONTH, MAX_MONTH)
    assert (out["monthly_amount_kwd"] == 40.0).all()
