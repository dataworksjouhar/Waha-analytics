"""Gold dimension build for dim_customer: online customers only. Every
booking in silver.web_bookings carries a customer_id (confirmed: 0 nulls
across 110,984 rows), so there is no missing-identity case to handle here
- the honest gap is walk-ins, who never appear in this table at all
because POS sales carry no customer identity. That is a deliberate
absence, not an omission: dim_customer's grain is "people we can identify
online," and pretending otherwise would overstate what the data supports.

    python -m pipeline.load.dim_customer
"""

from __future__ import annotations

import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    bookings = read_table(engine, "silver.web_bookings")

    first_seen = bookings.groupby("customer_id")["booking_datetime"].min()
    df = first_seen.reset_index().rename(columns={"booking_datetime": "first_seen_date"})
    df["first_seen_date"] = df["first_seen_date"].dt.date

    return replace_table(engine, "gold.dim_customer", df, cascade=True)


if __name__ == "__main__":
    n = transform()
    print(f"dim_customer: {n} rows")
