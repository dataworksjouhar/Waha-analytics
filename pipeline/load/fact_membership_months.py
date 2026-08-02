"""Gold fact build for fact_membership_months: contract x month grain,
periodic snapshot fact. Gym memberships, equestrian club memberships and
horse boarding all share this one table, since they are the same
member-month recurring-revenue shape (the architecture doc's central
modelling point for this venue).

The reconstruction problem: silver.contracts keeps only the latest known
state per contract_id (each contracts_YYYYMM.csv re-exports every
contract's current status in place, and silver dedupes to the last file
per contract - see pipeline/transform/contracts.py). There is no monthly
history to copy; it has to be derived from start_date, end_date and
status, one row per calendar month the contract was active.

Four things the derivation has to get right:

- The data window has an edge at both ends (dim_date's first and last
  month, July 2024 and July 2026). The park narrative has the business
  opening in 2023, a year before the window starts, and 39 contracts
  (found live: CTR001798 among them, start_date 2023-07-17) actually
  predate July 2024 - real founding members, not a data error. Their
  generated range starts at the window's first month, not their true
  start_month, and effective_start_month tracks that clamp separately
  from start_month for the same reason true_end_month is tracked
  separately from capped_end_month below.
- Symmetrically, a contract with no end_date (849 of 974 "active"
  contracts) or an end_date past the window (the other 125) is still
  genuinely ongoing as far as the data can show - it generates rows up to
  the window's last month, not "forever", and is_churned is never set for
  it, because nothing in the data says it actually ended.
- is_new is only set where the contract's true start_month itself falls
  inside the window - a founding member already active when the window
  opens is not "new" at that window's first month, even though that's the
  first row generated for them. is_churned is symmetric: only set on the
  one row where the true end falls inside the window AND status is
  cancelled/expired. A contract can be is_new and is_churned in the same
  row if it started and ended within one calendar month.
- mrr_kwd is the full monthly_amount_kwd for every month generated, no
  proration for a partial start or end month. Simpler, and matches how
  membership-month MRR is conventionally reported (credit the whole month
  once the contract is active in it).

This is a client-side cross join (contracts x months, then filtered down
to each contract's real range), not a SQL join, because the row-generating
step - "explode one row into N months" - has no source table to merge
against; contract count x ~25 months stays small enough that this is
cheap in pandas regardless.

explode_contract_months is split out from transform() specifically so
tests/test_fact_membership_months.py can exercise the window-clamping,
is_new and is_churned derivation against small synthetic contracts without
a database - that logic, not the dimension key lookups around it, is the
part worth pinning down with tests.

    python -m pipeline.load.fact_membership_months
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.load.dim_member import resolve_member_id
from pipeline.util import read_table, replace_table


def explode_contract_months(
    contracts: pd.DataFrame, min_data_month: pd.Timestamp, max_data_month: pd.Timestamp
) -> pd.DataFrame:
    """contracts: contract_id, start_date, end_date (nullable), status,
    monthly_amount_kwd, plus any other columns the caller wants carried
    through (member/venue/stable ids). Returns one row per calendar month
    in [min_data_month, max_data_month] each contract was active, with
    month_date, is_new, is_churned and month_status added. See this
    module's docstring for the four rules this has to satisfy."""
    contracts = contracts.copy()
    contracts["start_month"] = pd.to_datetime(contracts["start_date"]).values.astype("datetime64[M]")
    true_end_month = pd.to_datetime(contracts["end_date"]).values.astype("datetime64[M]")

    contracts["effective_start_month"] = contracts["start_month"].clip(lower=min_data_month)
    contracts["true_end_month"] = pd.Series(true_end_month, index=contracts.index)
    contracts["capped_end_month"] = contracts["true_end_month"].fillna(max_data_month).clip(
        upper=max_data_month
    )

    months = pd.DataFrame({"month_date": pd.date_range(min_data_month, max_data_month, freq="MS")})
    contracts["_k"] = 1
    months["_k"] = 1
    cross = contracts.merge(months, on="_k").drop(columns="_k")
    cross = cross[
        (cross["month_date"] >= cross["effective_start_month"])
        & (cross["month_date"] <= cross["capped_end_month"])
    ].copy()

    started_in_window = cross["start_month"] >= min_data_month
    cross["is_new"] = (cross["month_date"] == cross["start_month"]) & started_in_window
    ended_in_window = cross["true_end_month"].notna() & (cross["true_end_month"] <= max_data_month)
    is_end_month = cross["month_date"] == cross["capped_end_month"]
    cross["is_churned"] = is_end_month & ended_in_window & cross["status"].isin(["cancelled", "expired"])
    cross["month_status"] = "active"
    cross.loc[cross["is_churned"], "month_status"] = cross.loc[cross["is_churned"], "status"]

    return cross


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    contracts = read_table(engine, "silver.contracts")

    with engine.begin() as conn:
        dates = pd.read_sql("SELECT date_key, full_date FROM gold.dim_date", conn)
        members = pd.read_sql("SELECT member_key, member_id FROM gold.dim_member", conn)
        venues = pd.read_sql("SELECT venue_key, venue_id FROM gold.dim_venue", conn)
        stables = pd.read_sql("SELECT stable_key, stable_id FROM gold.dim_stable", conn)

    dates["full_date"] = pd.to_datetime(dates["full_date"])

    contracts = contracts.copy()
    contracts["canonical_member_id"] = resolve_member_id(contracts)

    min_data_month = pd.to_datetime(dates["full_date"]).min().to_period("M").to_timestamp()
    max_data_month = pd.to_datetime(dates["full_date"]).max().to_period("M").to_timestamp()
    cross = explode_contract_months(contracts, min_data_month, max_data_month)

    cross = cross.merge(dates, left_on="month_date", right_on="full_date", how="left")
    cross = cross.merge(members, left_on="canonical_member_id", right_on="member_id", how="left")
    cross = cross.merge(venues, on="venue_id", how="left")
    cross = cross.merge(stables, on="stable_id", how="left")

    df = pd.DataFrame({
        "contract_id": cross["contract_id"],
        "member_key": cross["member_key"].astype("Int64"),
        "venue_key": cross["venue_key"].astype("Int64"),
        "month_date_key": cross["date_key"].astype("Int64"),
        "contract_type": cross["contract_type"],
        "stable_key": cross["stable_key"].astype("Int64"),
        "mrr_kwd": cross["monthly_amount_kwd"],
        "status": cross["month_status"],
        "is_new": cross["is_new"],
        "is_churned": cross["is_churned"],
    })
    return replace_table(engine, "gold.fact_membership_months", df)


if __name__ == "__main__":
    n = transform()
    print(f"fact_membership_months: {n} rows")
