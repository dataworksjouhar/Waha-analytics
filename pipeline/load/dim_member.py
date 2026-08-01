"""Gold dimension build for dim_member: gym, equestrian club and boarding
members, identity-resolved on phone number. silver.contracts already
flags rows whose phone_number is shared across more than one member_id
(shared_phone_across_members, from session 9) without merging them - that
merge is this table's job, per the architecture doc's description of
dim_member as identity-resolved.

Resolution rule: contracts sharing a phone_number collapse to one
identity, the lowest member_id in that phone group (arbitrary but
deterministic - there is no signal in the data for which of two source
systems is more authoritative). A contract with no phone_number has
nothing to match on and stays its own identity.

fact_membership_months (session 11) needs this exact same mapping to
attach the right member_key to each contract row, so resolve_member_id
is exported for that session to call again against a fresh read of
silver.contracts, rather than persisting a separate crosswalk table or
re-deriving the grouping a second, possibly inconsistent, way.

    python -m pipeline.load.dim_member
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table


def resolve_member_id(contracts: pd.DataFrame) -> pd.Series:
    """Raw member_id -> canonical member_id, aligned to contracts' index."""
    canonical = contracts.groupby("phone_number")["member_id"].transform("min")
    return canonical.where(contracts["phone_number"].notna(), contracts["member_id"])


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    contracts = read_table(engine, "silver.contracts")

    contracts["canonical_member_id"] = resolve_member_id(contracts)
    grouped = contracts.groupby("canonical_member_id", as_index=False).agg(
        phone=("phone_number", "first"),
        first_contract_start_date=("start_date", "min"),
    )
    df = grouped.rename(columns={"canonical_member_id": "member_id"})

    return replace_table(engine, "gold.dim_member", df, cascade=True)


if __name__ == "__main__":
    n = transform()
    print(f"dim_member: {n} rows")
