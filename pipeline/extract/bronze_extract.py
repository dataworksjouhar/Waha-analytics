"""Bronze extract layer: scans data/bronze/, registers every file in
bronze.file_registry, and loads raw CSV contents into per-source bronze
staging tables with no transformation applied (every column stays TEXT,
read with dtype=str so pandas never reformats a number or date string).

Idempotent: a file whose checksum already matches a 'processed' registry
entry is skipped entirely, so re-running never doubles row counts. If a
file's content changes (checksum differs), its previously loaded rows are
deleted and reloaded rather than appended alongside the old ones.

Batched per source rather than one transaction per file: at ~4700 files,
one network round-trip per file against a remote Postgres instance (this
project's Supabase database sits in ap-south-1) took the better part of an
hour. Reading every unprocessed file for a source into one DataFrame and
issuing one multi-row INSERT (chunked) plus one bulk registry upsert cuts
that to a couple of minutes.

    python -m pipeline.extract.bronze_extract
"""

from __future__ import annotations

import hashlib
import re
import time
from pathlib import Path

import pandas as pd
import sqlalchemy

from pipeline.db import get_engine, with_retries

BRONZE_DIR = Path("data/bronze")
INSERT_CHUNKSIZE = 500
FILES_PER_TRANSACTION = 40  # keeps each transaction short-lived; the free-tier
                            # Supabase pooler dropped the connection when one
                            # transaction tried to cover all 731 POS files at once

# source_name -> (glob under data/bronze/<source_name>/, bronze raw table)
DAILY_SOURCES = {
    "pos_sales": ("d365_salesline_*.csv", "bronze.pos_sales_raw"),
    "footfall": ("footfall_*.csv", "bronze.footfall_raw"),
    "web_sessions": ("web_sessions_*.csv", "bronze.web_sessions_raw"),
    "web_bookings": ("web_bookings_*.csv", "bronze.web_bookings_raw"),
    "weather": ("weather_*.csv", "bronze.weather_raw"),
    "lessons": ("lessons_*.csv", "bronze.lessons_raw"),
}

MASTER_DATA_TABLES = {
    "venues.csv": "bronze.master_venues_raw",
    "gates.csv": "bronze.master_gates_raw",
    "products.csv": "bronze.master_products_raw",
    "tenants.csv": "bronze.master_tenants_raw",
    "stables.csv": "bronze.master_stables_raw",
    "instructors.csv": "bronze.master_instructors_raw",
    "horses.csv": "bronze.master_horses_raw",
}

TENANT_FILENAME_RE = re.compile(
    r"tenant_sales_(?P<tenant_id>[a-z0-9]+)_(?P<month>\d{4}-\d{2})(?P<restated>_restated)?\.csv$"
)


def _checksum(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def _registered_checksums(conn, source_name: str) -> dict[str, tuple[str, str]]:
    """file_name -> (checksum, status) for every file already registered
    under this source, fetched in one query rather than per file."""
    rows = conn.execute(
        sqlalchemy.text("SELECT file_name, checksum, status FROM bronze.file_registry WHERE source_name = :s"),
        {"s": source_name},
    ).fetchall()
    return {r[0]: (r[1], r[2]) for r in rows}


def _files_needing_load(files: list[Path], registered: dict[str, tuple[str, str]]) -> list[tuple[Path, str, bool]]:
    """Returns (path, checksum, is_changed) for every file that is new or
    whose checksum differs from what's registered. is_changed distinguishes
    a first-time load from a reload, since only reloads need a prior DELETE."""
    todo = []
    for path in files:
        checksum = _checksum(path)
        prior = registered.get(path.name)
        if prior is not None and prior[0] == checksum and prior[1] == "processed":
            continue
        todo.append((path, checksum, prior is not None))
    return todo


def _bulk_register(conn, source_name: str, entries: list[tuple[str, str, int, str]]) -> None:
    """entries: (file_name, file_path, row_count, checksum)."""
    if not entries:
        return
    conn.execute(
        sqlalchemy.text(
            """
            INSERT INTO bronze.file_registry
                (source_name, file_name, file_path, load_date, row_count, checksum, status, processed_at)
            VALUES
                (:source_name, :file_name, :file_path, CURRENT_DATE, :row_count, :checksum, 'processed', now())
            ON CONFLICT (source_name, file_name) DO UPDATE SET
                row_count = EXCLUDED.row_count,
                checksum = EXCLUDED.checksum,
                status = 'processed',
                processed_at = now()
            """
        ),
        [
            {"source_name": source_name, "file_name": fn, "file_path": fp, "row_count": rc, "checksum": cs}
            for fn, fp, rc, cs in entries
        ],
    )


def _load_file_chunk(engine, source_name: str, chunk: list[tuple[Path, str, bool]], table: str, read_fn) -> None:
    """Loads one small group of files in a single transaction, retrying the
    whole transaction on a transient connection drop."""
    schema, table_name = table.split(".")

    def _do_load():
        with engine.begin() as conn:
            changed_names = [path.name for path, _, is_changed in chunk if is_changed]
            if changed_names:
                conn.execute(
                    sqlalchemy.text(f"DELETE FROM {table} WHERE _source_file = ANY(:names)"),
                    {"names": changed_names},
                )

            frames = [read_fn(path) for path, _, _ in chunk]
            registry_entries = [
                (path.name, str(path), len(df), checksum)
                for (path, checksum, _), df in zip(chunk, frames)
            ]

            combined = pd.concat(frames, ignore_index=True)
            combined.to_sql(
                table_name, conn, schema=schema, if_exists="append", index=False,
                method="multi", chunksize=INSERT_CHUNKSIZE,
            )
            _bulk_register(conn, source_name, registry_entries)

    with_retries(_do_load)


def _load_batch(engine, source_name: str, files: list[Path], table: str, read_fn, verbose: bool = True) -> int:
    """Figures out which files are new/changed, then loads them in small
    file-count chunks (each its own short-lived transaction) rather than
    one transaction spanning the whole source."""
    def _fetch_registered():
        with engine.begin() as conn:
            return _registered_checksums(conn, source_name)

    registered = with_retries(_fetch_registered)
    todo = _files_needing_load(files, registered)
    if not todo:
        return 0

    for i in range(0, len(todo), FILES_PER_TRANSACTION):
        chunk = todo[i : i + FILES_PER_TRANSACTION]
        _load_file_chunk(engine, source_name, chunk, table, read_fn)
        if verbose and len(todo) > FILES_PER_TRANSACTION:
            print(f"    {source_name}: {min(i + FILES_PER_TRANSACTION, len(todo))}/{len(todo)} files")

    return len(todo)


def _read_generic(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str)
    df.columns = df.columns.str.lower()  # POS arrives D365-uppercase; bronze columns are unquoted lowercase
    df["_source_file"] = path.name
    return df


def _read_tenant_sales_fn(manifest: pd.DataFrame):
    def _read(path: Path) -> pd.DataFrame:
        match = TENANT_FILENAME_RE.match(path.name)
        raw = pd.read_csv(path, dtype=str)
        tenant_id = match.group("tenant_id").upper()
        month = match.group("month")
        is_restatement = match.group("restated") is not None
        submitted_date = manifest.loc[path.name, "submitted_date"] if path.name in manifest.index else None
        return pd.DataFrame(
            {
                "tenant_id": tenant_id,
                "sales_month": month,
                "is_restatement": is_restatement,
                "date_raw": raw["date"] if "date" in raw.columns else None,
                "gross_sales_raw": raw["gross_sales"] if "gross_sales" in raw.columns else None,
                "net_sales_raw": raw["net_sales"] if "net_sales" in raw.columns else None,
                "submitted_date": submitted_date,
                "_source_file": path.name,
            }
        )

    return _read


def extract_all(engine: sqlalchemy.engine.Engine | None = None, verbose: bool = True) -> dict[str, int]:
    engine = engine or get_engine()
    counts: dict[str, int] = {}

    for source_name, (pattern, table) in DAILY_SOURCES.items():
        t0 = time.time()
        files = sorted((BRONZE_DIR / source_name).glob(pattern))
        counts[source_name] = _load_batch(engine, source_name, files, table, _read_generic)
        if verbose:
            print(f"  {source_name}: {counts[source_name]} files loaded ({time.time() - t0:.1f}s)")

    t0 = time.time()
    events_files = sorted((BRONZE_DIR / "events").glob("events.csv"))
    counts["events"] = _load_batch(engine, "events", events_files, "bronze.events_raw", _read_generic)
    if verbose:
        print(f"  events: {counts['events']} files loaded ({time.time() - t0:.1f}s)")

    t0 = time.time()
    contract_files = sorted((BRONZE_DIR / "contracts").glob("contracts_*.csv"))
    counts["contracts"] = _load_batch(engine, "contracts", contract_files, "bronze.contracts_raw", _read_generic)
    if verbose:
        print(f"  contracts: {counts['contracts']} files loaded ({time.time() - t0:.1f}s)")

    t0 = time.time()
    tenant_dir = BRONZE_DIR / "tenant_sales"
    manifest_path = tenant_dir / "_submission_manifest.csv"
    manifest = pd.read_csv(manifest_path).set_index("filename") if manifest_path.exists() else pd.DataFrame()
    tenant_files = sorted(p for p in tenant_dir.glob("tenant_sales_*.csv"))
    counts["tenant_sales"] = _load_batch(
        engine, "tenant_sales", tenant_files, "bronze.tenant_sales_raw", _read_tenant_sales_fn(manifest)
    )
    if verbose:
        print(f"  tenant_sales: {counts['tenant_sales']} files loaded ({time.time() - t0:.1f}s)")

    t0 = time.time()
    n_master = 0
    for file_name, table in MASTER_DATA_TABLES.items():
        path = BRONZE_DIR / "master_data" / file_name
        if not path.exists():
            continue
        n_master += _load_batch(engine, "master_data", [path], table, _read_generic)
    counts["master_data"] = n_master
    if verbose:
        print(f"  master_data: {counts['master_data']} files loaded ({time.time() - t0:.1f}s)")

    return counts


if __name__ == "__main__":
    print("Extracting bronze files...")
    result = extract_all()
    print()
    print("Files newly loaded by source:")
    for source, n in result.items():
        print(f"  {source}: {n}")
