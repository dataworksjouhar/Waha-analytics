"""Gold fact build for fact_pos_sales: invoice line grain, transaction
fact, own-operated venues only.

Two lookups, both plain (no SCD, no crosswalk):
- venue_key from dim_venue on venue_id (D365's INVENTLOCATIONID, already
  the venue code, per silver.pos_sales_lines).
- product_key from dim_product on product_id: pos_sales_lines.item_id IS
  the product_id, not the product_code, since D365's ITEMID is populated
  straight from products.csv's product_id column in the generator
  (generator/pos.py PRODUCT_INFO keys on product_code but emits
  product_id as ITEMID). No crosswalk needed here, unlike fact_bookings.

is_duplicate rows are dropped at this layer: silver kept them (visible,
flagged) so the raw re-export evidence stays queryable, but a revenue
fact table must not double-count a line that only exists twice because of
an export overlap. date_key comes from invoice_date; nothing else in this
row needs a lookup.

    python -m pipeline.load.fact_pos_sales
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    silver = read_table(engine, "silver.pos_sales_lines")
    silver = silver[~silver["is_duplicate"]]

    with engine.begin() as conn:
        dates = pd.read_sql("SELECT date_key, full_date FROM gold.dim_date", conn)
        venues = pd.read_sql("SELECT venue_key, venue_id FROM gold.dim_venue", conn)
        products = pd.read_sql("SELECT product_key, product_id FROM gold.dim_product", conn)

    merged = silver.merge(dates, left_on="invoice_date", right_on="full_date", how="left")
    merged = merged.merge(venues, on="venue_id", how="left")
    merged = merged.merge(products, left_on="item_id", right_on="product_id", how="left")

    unmatched_date = merged["date_key"].isna().sum()
    if unmatched_date:
        # Known generator boundary quirk (see docs/phase1-runbook.md notes
        # for later): a refund's invoice_date is its original sale date
        # plus a few days, which can push a handful of late-window refunds
        # past config.generator.date_range.end. dim_date correctly stops at
        # the configured end, so these rows have nothing to join to. date_key
        # is NOT NULL, so they can't be loaded with a null FK; dropped here
        # rather than crashing the load, and reported so the gap is visible.
        print(f"  warning: dropping {unmatched_date} pos_sales_lines rows dated past the dim_date window")
        merged = merged[merged["date_key"].notna()]

    df = pd.DataFrame({
        "invoice_id": merged["invoice_id"],
        "date_key": merged["date_key"].astype("Int64"),
        "venue_key": merged["venue_key"].astype("Int64"),
        "product_key": merged["product_key"].astype("Int64"),
        "qty": merged["qty"],
        "sales_price_kwd": merged["sales_price_kwd"],
        "line_amount_kwd": merged["line_amount_kwd"],
        "payment_mode": merged["payment_mode"],
        "is_refund": merged["is_refund"],
    })
    return replace_table(engine, "gold.fact_pos_sales", df)


if __name__ == "__main__":
    n = transform()
    print(f"fact_pos_sales: {n} rows")
