"""Applies the static spatial attributes (zone, gate rollup label, gate
proximity) to the gold dimensions from the `spatial` section of
config/client_waha.yml.

Why this is its own module rather than part of dim_simple.py and
dim_tenant.py:

These columns do not come from a source system. Every other column in
dim_gate, dim_venue and dim_tenant arrives from silver, which arrives from
a file the client sent us. Zone does not. Nobody at Al Waha exports a
"which part of the site is this" column, and pretending otherwise by
stuffing it into the seed CSVs would misrepresent where the knowledge came
from. It is operator knowledge, captured in config, applied on top. Keeping
that in a separate step makes the provenance visible in the code layout
itself, which is the honest version and also the interviewable one.

Why UPDATE and not part of the COPY:

pipeline/util.replace_table TRUNCATEs a dimension and COPYs the silver
columns back in, so anything not in silver is null immediately after a
rebuild. This runs after those loads and puts the config-sourced columns
back. That ordering is the whole reason the module exists: without it, a
`python pipeline/run.py` would silently blank every zone in the warehouse
and the only symptom would be a dashboard breakdown quietly going empty.

Idempotent, and safe to run on its own against an already-built warehouse
without touching a single fact row:

    python -m pipeline.load.spatial_metadata
"""

from __future__ import annotations

import sqlalchemy

from pipeline.db import get_engine, with_retries
from pipeline.util import load_config

# Which config block drives which table, and under which key column. The
# three cases are the same shape, so they share one code path rather than
# three near-identical functions: adding a fourth spatial dimension later
# is a line here, not a new function.
TARGETS = [
    # (config key, table, natural key column, columns to set)
    ("gates", "gold.dim_gate", "gate_id", ["gate_label", "zone", "primary_venue_served"]),
    ("venues", "gold.dim_venue", "venue_id", ["zone", "gate_proximity"]),
    ("tenants", "gold.dim_tenant", "tenant_id", ["zone", "gate_proximity"]),
]


def apply(engine: sqlalchemy.engine.Engine | None = None, config: dict | None = None) -> dict[str, int]:
    """Sets the spatial columns on every gold dimension that has them.

    Returns rows updated per table. For dim_tenant that count exceeds the
    number of tenants, because it is SCD Type 2 and every version of a
    tenant's record gets the attribute. That is intended: a unit does not
    move when a tenant changes category, so the value is the same in all
    versions and a fact joined to an old version still resolves its zone.
    """
    engine = engine or get_engine()
    config = config or load_config()
    spatial = config["spatial"]

    updated: dict[str, int] = {}
    for config_key, table, key_column, columns in TARGETS:
        entries = spatial[config_key]

        # Bound parameters, not string-formatted values: these are config
        # strings and the risk is low, but building SQL by concatenation is
        # a habit worth not having. Column and table names are from the
        # TARGETS constant above, never from input, so those are safe to
        # interpolate.
        assignments = ", ".join(f"{col} = :{col}" for col in columns)
        statement = sqlalchemy.text(
            f"UPDATE {table} SET {assignments} WHERE {key_column} = :key"
        )

        def _run(statement=statement, entries=entries, columns=columns):
            total = 0
            with engine.begin() as conn:
                for key, attributes in entries.items():
                    params = {"key": key}
                    # .get, not [], so a config entry that omits an optional
                    # attribute writes null rather than raising. Null is a
                    # real value in this column set: a gate serving the whole
                    # site has no single venue.
                    params.update({col: attributes.get(col) for col in columns})
                    total += conn.execute(statement, params).rowcount
            return total

        updated[table] = with_retries(_run)

    return updated


if __name__ == "__main__":
    for table, rows in apply().items():
        print(f"{table}: {rows} rows updated")
