"""Silver transform for Source 7 (membership and boarding contracts): gym
memberships, equestrian club memberships and horse boarding in one
structure, since they are the same member-month recurring-revenue shape.

Each contracts_YYYYMM.csv is a full re-export of every contract's current
state, not just new ones: the same contract_id reappears in every export
after it starts, and its status/cancellation_date/end_date get updated in
place as the contract's real-world state changes (56% of contracts change
status somewhere across their exports, confirmed against the actual bronze
files). Silver therefore keeps the latest snapshot per contract_id, not
every monthly row; the month-by-month periodic-snapshot fact
(fact_membership_months) is a gold-layer build (session 11) that
reconstructs history from start_date/end_date/status, not a copy of these
repeated exports.

end_date is null only while a contract is genuinely still open-ended - the
moment one is cancelled or a fixed term completes, the source reliably
fills it in (mirroring cancellation_date, or the term end for a naturally
expired contract), so there is nothing to impute there.

Two DQ issues, both flagged rather than corrected:
- cancellation_date before start_date: nonsensical, but the source's
  numbers are what they are.
- phone_number shared across more than one member_id: the actual merge
  into one canonical member happens in gold's dim_member build (session
  10), which is where "identity-resolved on phone" is a property of the
  dimension. Silver's job is to surface the collision, not resolve it.

    python -m pipeline.transform.contracts
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    raw = read_table(engine, "bronze.contracts_raw")

    # contracts_YYYYMM.csv sorts lexically in chronological order, so the
    # last file a contract_id appears in is its most recent known state.
    raw = raw.sort_values("_source_file")
    latest = raw.drop_duplicates("contract_id", keep="last")

    df = pd.DataFrame({
        "contract_id": latest["contract_id"],
        "member_id": latest["member_id"],
        "contract_type": latest["contract_type"],
        "venue_id": latest["venue_id"],
        "start_date": pd.to_datetime(latest["start_date"]).dt.date,
        "end_date": pd.to_datetime(latest["end_date"]).dt.date,
        "monthly_amount_kwd": pd.to_numeric(latest["monthly_amount_kwd"]),
        "status": latest["status"],
        "cancellation_date": pd.to_datetime(latest["cancellation_date"]).dt.date,
        "stable_id": latest["stable_id"],
        "phone_number": latest["phone_number"],
        "_source_file": latest["_source_file"],
    }).reset_index(drop=True)

    cancel_before_start = df["cancellation_date"].notna() & (df["cancellation_date"] < df["start_date"])
    shared_phone = df["phone_number"].notna() & (df.groupby("phone_number")["member_id"].transform("nunique") > 1)

    dq_flags = [[] for _ in range(len(df))]
    for i, (bad_cancel, dup_phone) in enumerate(zip(cancel_before_start, shared_phone)):
        if bad_cancel:
            dq_flags[i].append("cancellation_before_start")
        if dup_phone:
            dq_flags[i].append("shared_phone_across_members")
    df["_dq_flags"] = dq_flags

    return replace_table(engine, "silver.contracts", df)


if __name__ == "__main__":
    n = transform()
    print(f"contracts: {n} rows")
