"""Silver transform for Source 9 (master/reference data): venues, gates,
products, tenants, stables, instructors, horses. These files are clean by
design (no mess.py imperfections), so this is pure type-casting from
bronze's all-TEXT staging tables into properly typed silver tables. The
one thing worth noting: silver.tenants keeps one row per SCD2 *version*
(tenants.csv has two rows for the tenant that changes category) - that
versioning is exactly what the gold SCD2 build in session 10 consumes, so
it is preserved here, not collapsed.

    python -m pipeline.transform.master_data
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.transform.util import read_bronze, replace_silver_table


def _date(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s, errors="coerce").dt.date


def _num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def transform_venues(engine: sqlalchemy.engine.Engine) -> int:
    raw = read_bronze(engine, "bronze.master_venues_raw")
    df = pd.DataFrame({
        "venue_id": raw["venue_id"],
        "venue_name": raw["venue_name"],
        "venue_type": raw["venue_type"],
        "opened_date": _date(raw["opened_date"]),
        "description": raw["description"],
        "_source_file": raw["_source_file"],
    })
    return replace_silver_table(engine, "silver.venues", df)


def transform_gates(engine: sqlalchemy.engine.Engine) -> int:
    raw = read_bronze(engine, "bronze.master_gates_raw")
    df = pd.DataFrame({
        "gate_id": raw["gate_id"],
        "gate_name": raw["gate_name"],
        "description": raw["description"],
        "_source_file": raw["_source_file"],
    })
    return replace_silver_table(engine, "silver.gates", df)


def transform_products(engine: sqlalchemy.engine.Engine) -> int:
    raw = read_bronze(engine, "bronze.master_products_raw")
    df = pd.DataFrame({
        "product_id": raw["product_id"],
        "product_code": raw["product_code"],
        "product_name": raw["product_name"],
        "venue_id": raw["venue_id"],
        "category": raw["category"],
        "unit_price_kwd": _num(raw["unit_price_kwd"]),
        "_source_file": raw["_source_file"],
    })
    return replace_silver_table(engine, "silver.products", df)


def transform_tenants(engine: sqlalchemy.engine.Engine) -> int:
    raw = read_bronze(engine, "bronze.master_tenants_raw")
    df = pd.DataFrame({
        "tenant_id": raw["tenant_id"],
        "tenant_name": raw["tenant_name"],
        "category": raw["category"],
        "unit_no": raw["unit_no"],
        "unit_sqm": _num(raw["unit_sqm"]),
        "lease_start": _date(raw["lease_start"]),
        "lease_end": _date(raw["lease_end"]),
        "base_rent_kwd": _num(raw["base_rent_kwd"]),
        "turnover_rent_pct": _num(raw["turnover_rent_pct"]),
        "turnover_threshold_kwd": _num(raw["turnover_threshold_kwd"]),
        "status": raw["status"],
        "effective_start_date": _date(raw["effective_start_date"]),
        "effective_end_date": _date(raw["effective_end_date"]),
        "_source_file": raw["_source_file"],
    })
    return replace_silver_table(engine, "silver.tenants", df)


def transform_stables(engine: sqlalchemy.engine.Engine) -> int:
    raw = read_bronze(engine, "bronze.master_stables_raw")
    df = pd.DataFrame({
        "stable_id": raw["stable_id"],
        "box_no": raw["box_no"],
        "size_category": raw["size_category"],
        "status": raw["status"],
        "_source_file": raw["_source_file"],
    })
    return replace_silver_table(engine, "silver.stables", df)


def transform_instructors(engine: sqlalchemy.engine.Engine) -> int:
    raw = read_bronze(engine, "bronze.master_instructors_raw")
    df = pd.DataFrame({
        "instructor_id": raw["instructor_id"],
        "instructor_name": raw["instructor_name"],
        "specialty_level": raw["specialty_level"],
        "hire_date": _date(raw["hire_date"]),
        "status": raw["status"],
        "_source_file": raw["_source_file"],
    })
    return replace_silver_table(engine, "silver.instructors", df)


def transform_horses(engine: sqlalchemy.engine.Engine) -> int:
    raw = read_bronze(engine, "bronze.master_horses_raw")
    df = pd.DataFrame({
        "horse_id": raw["horse_id"],
        "horse_name": raw["horse_name"],
        "breed": raw["breed"],
        "level_suitability": raw["level_suitability"],
        "stable_id": raw["stable_id"],
        "_source_file": raw["_source_file"],
    })
    return replace_silver_table(engine, "silver.horses", df)


def transform_all(engine: sqlalchemy.engine.Engine | None = None) -> dict[str, int]:
    engine = engine or get_engine()
    return {
        "venues": transform_venues(engine),
        "gates": transform_gates(engine),
        "products": transform_products(engine),
        "tenants": transform_tenants(engine),
        "stables": transform_stables(engine),
        "instructors": transform_instructors(engine),
        "horses": transform_horses(engine),
    }


if __name__ == "__main__":
    print("Transforming master data...")
    for name, n in transform_all().items():
        print(f"  {name}: {n} rows")
