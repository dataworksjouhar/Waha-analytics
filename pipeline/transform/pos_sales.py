"""Silver transform for Source 1 (D365 F&O POS sales lines, own-operated
venues).

Two cleaning decisions:
- venue_id: D365's INVENTSITEID is always "AWP" (the one physical site);
  INVENTLOCATIONID already carries the venue code (V01-V04) the generator
  assigned, so no fuzzy conforming is needed, just a rename/cast.
- is_duplicate: mess.py creates duplicates by copying a row byte-for-byte
  into the same day's file (a re-export overlap), so the dedup key is every
  business column. The first occurrence in a group is treated as real; any
  further occurrence is flagged, not dropped, so a gold fact table can
  filter WHERE NOT is_duplicate while the raw evidence stays queryable.

    python -m pipeline.transform.pos_sales
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.transform.util import read_bronze, replace_silver_table

_DEDUP_KEY = [
    "invoice_id", "sales_id", "invoice_date", "item_id", "qty",
    "sales_price_kwd", "line_amount_kwd", "created_datetime", "payment_mode", "cust_account",
]


def transform(engine: sqlalchemy.engine.Engine | None = None) -> int:
    engine = engine or get_engine()
    raw = read_bronze(engine, "bronze.pos_sales_raw")

    df = pd.DataFrame({
        "invoice_id": raw["invoiceid"],
        "sales_id": raw["salesid"],
        "invoice_date": pd.to_datetime(raw["invoicedate"]).dt.date,
        "item_id": raw["itemid"],
        "item_name": raw["itemname"],
        "qty": pd.to_numeric(raw["qty"]),
        "sales_price_kwd": pd.to_numeric(raw["salesprice"]),
        "line_amount_kwd": pd.to_numeric(raw["lineamount"]),
        "venue_id": raw["inventlocationid"],
        "cust_account": raw["custaccount"],
        "payment_mode": raw["paymentmode"],
        "created_datetime": pd.to_datetime(raw["createddatetime"]),
        "_source_file": raw["_source_file"],
    })

    df["is_refund"] = df["qty"] < 0
    df["is_duplicate"] = df.groupby(_DEDUP_KEY, dropna=False).cumcount() > 0

    return replace_silver_table(engine, "silver.pos_sales_lines", df)


if __name__ == "__main__":
    n = transform()
    print(f"pos_sales_lines: {n} rows")
