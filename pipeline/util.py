"""Shared helpers for the silver and gold load stages. Every load reads its
source table fully into pandas, cleans/conforms it, and replaces the
target table wholesale: the layer below is the immutable source of truth,
so rebuilding downstream from it each run is trivially idempotent, at the
cost of redoing work that an incremental design would skip.

Both the read and the write are chunked against Supabase's free-tier
pooler, which enforces a 2-minute statement_timeout: a single unchunked
SELECT or COPY over the largest table (bronze.pos_sales_raw, ~310k rows)
can exceed that window and gets cancelled outright, retries or not.
Chunking keeps every individual statement well under the limit regardless
of total table size.
"""

from __future__ import annotations

import io
from pathlib import Path

import pandas as pd
import sqlalchemy
import yaml

from pipeline.db import with_retries

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "client_waha.yml"

READ_CHUNK_ROWS = 20_000
WRITE_CHUNK_ROWS = 50_000


def load_config(path: str | Path = CONFIG_PATH) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def read_table(engine: sqlalchemy.engine.Engine, table: str) -> pd.DataFrame:
    """Reads a bronze or silver table via a server-side cursor so Postgres
    issues a DECLARE CURSOR plus repeated FETCH statements instead of one
    blocking SELECT. Each FETCH gets its own shot at the statement_timeout
    clock, so a table with more rows than fit in one 2-minute window still
    reads reliably; a plain SELECT * on pos_sales_raw does not."""

    def _read():
        with engine.connect().execution_options(stream_results=True) as conn:
            chunks = list(pd.read_sql(f"SELECT * FROM {table}", conn, chunksize=READ_CHUNK_ROWS))
        return pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame()

    return with_retries(_read)


def _pg_array_literal(value: list | None) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None  # genuinely missing, not an empty array
    if not value:
        return "{}"
    escaped = (str(v).replace("\\", "\\\\").replace('"', '\\"') for v in value)
    return "{" + ",".join(f'"{v}"' for v in escaped) + "}"


def replace_table(engine: sqlalchemy.engine.Engine, table: str, df: pd.DataFrame, cascade: bool = False) -> int:
    """Truncates the target table and COPYs df in its place, in one
    transaction so a crash mid-load never leaves the table half-written.

    Uses psycopg2's COPY rather than to_sql's multi-row INSERT: at
    chunksize=500 the INSERT approach needs ~625 round trips to load
    pos_sales_lines, each paying the pooler's per-statement latency, which
    is what actually made that load take ten-plus minutes (not row-by-row
    inserts - it was already batched). COPY streams the data in one pass
    per chunk instead of one round trip per few hundred rows.

    List-valued columns (_dq_flags, horse_ids) are detected automatically
    and written as Postgres array literals; COPY infers the column type
    from the table's own DDL, so there is no need for callers to pin a
    SQLAlchemy dtype the way to_sql required.

    cascade=True is for gold dimensions with a FK pointing at them from
    another gold table. The full gold schema (dimensions and facts) is
    deployed together, so this isn't limited to the one real
    dimension-to-dimension case (dim_product -> dim_venue): every
    dimension a fact table will eventually reference already carries
    that constraint today, even with every fact table still empty.
    Postgres refuses a plain TRUNCATE against a referenced table
    regardless of whether the referencing table has rows, so cascade is
    needed on the first load, not just a later rerun. Safe today because
    nothing downstream survives a rebuild uncoordinated - the caller
    always reloads the dependent table in the same run - but once gold facts
    exist (session 11) an uncoordinated cascade could take out fact rows
    too, so this only belongs on calls where the immediate caller also
    reloads every dependent table itself.
    """
    array_cols = [c for c in df.columns if df[c].map(lambda v: isinstance(v, list)).any()]

    def _write():
        with engine.begin() as conn:
            conn.execute(sqlalchemy.text(f"TRUNCATE {table}{' CASCADE' if cascade else ''}"))
            if len(df):
                out = df.copy()
                for col in array_cols:
                    out[col] = out[col].map(_pg_array_literal)

                raw_conn = conn.connection.driver_connection
                columns = ", ".join(out.columns)
                for start in range(0, len(out), WRITE_CHUNK_ROWS):
                    buf = io.StringIO()
                    out.iloc[start:start + WRITE_CHUNK_ROWS].to_csv(
                        buf, index=False, header=False, sep="\t", na_rep="\\N"
                    )
                    buf.seek(0)
                    with raw_conn.cursor() as cur:
                        cur.copy_expert(
                            f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT csv, DELIMITER E'\\t', NULL '\\N')",
                            buf,
                        )
        return len(df)

    return with_retries(_write)
