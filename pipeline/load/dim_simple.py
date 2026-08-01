"""Gold builds for the seven Type 1 (no history tracked) dimensions:
venue, gate, product, stable, instructor and event map straight from
their silver master/conformed table with a surrogate key added; channel
has no source master file at all, since "channel" is never a first-class
entity anywhere upstream, only an attribute on web sessions and bookings
- dim_channel is built by discovering the distinct values that actually
appear. A null channel (web_bookings' direct-attribution-loss case,
already flagged in silver) gets no dim_channel row and so no fabricated
"unknown" bucket: facts will carry a null channel_key, the same honest
gap dim_customer already models for walk-in customers.

dim_product carries a FK to dim_venue, so dim_venue must load first; the
lookup is a plain merge against the just-loaded gold.dim_venue rather
than silver, since gold's venue_key is what the FK needs, not anything
silver has.

Every dimension here except dim_event is passed cascade=True. This isn't
about one dimension referencing another (dim_product -> dim_venue is the
only case of that): the full gold schema, dimensions and facts together,
is already deployed, so every dimension a fact table will eventually
reference already carries that FK constraint today, even though every
fact table is still empty. Postgres refuses a plain TRUNCATE against a
table with any FK pointing at it regardless of whether the referencing
table has rows, so cascade is required just to load a fresh dimension
today, not only on a second run. It's harmless right now because facts
are empty either way, but this is a marker for session 11: a dims-only
rerun after facts exist would silently wipe fact rows via cascade, so
that session's orchestrator needs to reload facts in the same pass
rather than run dimension loads in isolation.

    python -m pipeline.load.dim_simple
"""

from __future__ import annotations

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine
from pipeline.util import read_table, replace_table


def transform_venue(engine: sqlalchemy.engine.Engine) -> int:
    silver = read_table(engine, "silver.venues")
    df = silver[["venue_id", "venue_name", "venue_type", "opened_date", "description"]]
    return replace_table(engine, "gold.dim_venue", df, cascade=True)


def transform_gate(engine: sqlalchemy.engine.Engine) -> int:
    silver = read_table(engine, "silver.gates")
    df = silver[["gate_id", "gate_name", "description"]]
    return replace_table(engine, "gold.dim_gate", df, cascade=True)


def transform_product(engine: sqlalchemy.engine.Engine) -> int:
    silver = read_table(engine, "silver.products")
    with engine.begin() as conn:
        venues = pd.read_sql("SELECT venue_key, venue_id FROM gold.dim_venue", conn)

    merged = silver.merge(venues, on="venue_id", how="left")
    df = pd.DataFrame({
        "product_id": merged["product_id"],
        "product_code": merged["product_code"],
        "product_name": merged["product_name"],
        "venue_key": merged["venue_key"].astype("Int64"),
        "category": merged["category"],
        "unit_price_kwd": merged["unit_price_kwd"],
    })
    return replace_table(engine, "gold.dim_product", df, cascade=True)


def transform_stable(engine: sqlalchemy.engine.Engine) -> int:
    silver = read_table(engine, "silver.stables")
    df = silver[["stable_id", "box_no", "size_category", "status"]]
    return replace_table(engine, "gold.dim_stable", df, cascade=True)


def transform_instructor(engine: sqlalchemy.engine.Engine) -> int:
    silver = read_table(engine, "silver.instructors")
    df = silver[["instructor_id", "instructor_name", "specialty_level", "hire_date", "status"]]
    return replace_table(engine, "gold.dim_instructor", df, cascade=True)


def transform_event(engine: sqlalchemy.engine.Engine) -> int:
    silver = read_table(engine, "silver.events")
    df = silver[["event_id", "event_name", "event_type", "start_date", "end_date", "expected_attendance"]]
    return replace_table(engine, "gold.dim_event", df)


def transform_channel(engine: sqlalchemy.engine.Engine) -> int:
    sessions = read_table(engine, "silver.web_sessions")
    bookings = read_table(engine, "silver.web_bookings")
    channels = pd.concat([sessions["channel"], bookings["channel"]]).dropna().unique()
    df = pd.DataFrame({"channel_name": sorted(channels)})
    return replace_table(engine, "gold.dim_channel", df, cascade=True)


def transform_all(engine: sqlalchemy.engine.Engine | None = None) -> dict[str, int]:
    engine = engine or get_engine()
    n_venue = transform_venue(engine)
    return {
        "dim_venue": n_venue,
        "dim_gate": transform_gate(engine),
        "dim_product": transform_product(engine),
        "dim_stable": transform_stable(engine),
        "dim_instructor": transform_instructor(engine),
        "dim_event": transform_event(engine),
        "dim_channel": transform_channel(engine),
    }


if __name__ == "__main__":
    for name, n in transform_all().items():
        print(f"{name}: {n} rows")
