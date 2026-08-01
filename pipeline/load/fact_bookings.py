"""Gold fact build for fact_bookings: booking grain, transaction fact.

product_key needs a crosswalk, not a plain lookup. web_bookings.product_code
is a product *family* the booking website sells ("playground_ticket",
"gym_membership", "lesson_package_beginner"), while dim_product is built
from the POS SKU master and is one level more specific ("playground_ticket_
adult"/"_child"/"_family", "gym_membership_monthly"/"_annual",
"lesson_package_beginner_4"). Only 2 of 8 booking codes match a dim_product
code exactly (gym_daypass, event_ticket); the rest don't, because the
website checkout never captured which specific SKU a customer chose -
that's a real difference in grain between the web analytics taxonomy and
the ERP product master, not a data quality defect to clean up.

BOOKING_PRODUCT_FAMILY below is a deliberate, documented crosswalk to one
representative SKU per family, not a guess: none of the 12 business
questions need booking-level SKU precision (metric 5 is online-vs-walk-in
mix, metric 6 is channel conversion, metric 9 is revenue by line of
business), only the venue and category that hang off dim_product, which
are identical across every SKU in a family anyway.

channel_key is nullable: a small share of bookings carry no channel
(direct-attribution loss, already flagged in silver) and get a null
channel_key rather than a fabricated "unknown" bucket, the same honest-gap
pattern dim_customer uses for walk-ins. is_cancelled rows are kept, not
dropped, same as silver.

    python -m pipeline.load.fact_bookings
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table

BOOKING_PRODUCT_FAMILY = {
    "playground_ticket": "playground_ticket_adult",
    "farm_ticket": "farm_ticket_adult",
    "gym_daypass": "gym_daypass",
    "gym_membership": "gym_membership_monthly",
    "event_ticket": "event_ticket",
    "lesson_package_beginner": "lesson_package_beginner_4",
    "lesson_package_intermediate": "lesson_package_intermediate_4",
    "lesson_package_advanced": "lesson_package_advanced_4",
}


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    silver = read_table(engine, "silver.web_bookings")

    with engine.begin() as conn:
        dates = pd.read_sql("SELECT date_key, full_date FROM gold.dim_date", conn)
        products = pd.read_sql("SELECT product_key, product_code FROM gold.dim_product", conn)
        channels = pd.read_sql("SELECT channel_key, channel_name FROM gold.dim_channel", conn)
        customers = pd.read_sql("SELECT customer_key, customer_id FROM gold.dim_customer", conn)

    silver = silver.copy()
    silver["booking_date"] = pd.to_datetime(silver["booking_datetime"]).dt.date
    silver["product_code_sku"] = silver["product_code"].map(BOOKING_PRODUCT_FAMILY)

    unmapped = silver["product_code"][silver["product_code_sku"].isna()].unique()
    if len(unmapped):
        print(f"  warning: booking product_code(s) with no family mapping: {list(unmapped)}")

    merged = silver.merge(dates, left_on="booking_date", right_on="full_date", how="left")
    merged = merged.merge(products, left_on="product_code_sku", right_on="product_code", how="left")
    merged = merged.merge(channels, left_on="channel", right_on="channel_name", how="left")
    merged = merged.merge(customers, on="customer_id", how="left")

    unmatched_date = merged["date_key"].isna().sum()
    if unmatched_date:
        # Same generator boundary quirk as fact_pos_sales: a cancellation's
        # booking_datetime is a few days after the original booking, which
        # can push a handful of late-window cancellations past
        # config.generator.date_range.end (see docs/phase1-runbook.md
        # notes for later). Dropped rather than crashing the NOT NULL
        # date_key FK.
        print(f"  warning: dropping {unmatched_date} web_bookings rows dated past the dim_date window")
        merged = merged[merged["date_key"].notna()]

    df = pd.DataFrame({
        "booking_id": merged["booking_id"],
        "date_key": merged["date_key"].astype("Int64"),
        "product_key": merged["product_key"].astype("Int64"),
        "channel_key": merged["channel_key"].astype("Int64"),
        "customer_key": merged["customer_key"].astype("Int64"),
        "qty": merged["qty"],
        "amount_kwd": merged["amount_kwd"],
        "is_cancelled": merged["is_cancelled"],
    })
    return replace_table(engine, "gold.fact_bookings", df)


if __name__ == "__main__":
    n = transform()
    print(f"fact_bookings: {n} rows")
