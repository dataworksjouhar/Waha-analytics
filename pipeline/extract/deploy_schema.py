"""Applies the DDL in config/schema/ to the target Postgres database, in
filename order (00_bronze, 01_silver, 02_gold, 03_dq). Safe to re-run: every
statement in those files is CREATE SCHEMA/TABLE IF NOT EXISTS.

    python -m pipeline.extract.deploy_schema
"""

from __future__ import annotations

from pathlib import Path

import sqlalchemy

from pipeline.db import get_engine

SCHEMA_DIR = Path(__file__).resolve().parent.parent.parent / "config" / "schema"


def deploy_schema(engine: sqlalchemy.engine.Engine | None = None) -> None:
    engine = engine or get_engine()
    sql_files = sorted(SCHEMA_DIR.glob("*.sql"))
    with engine.begin() as conn:
        for sql_file in sql_files:
            print(f"Applying {sql_file.name}...")
            conn.execute(sqlalchemy.text(sql_file.read_text()))


if __name__ == "__main__":
    deploy_schema()
    print("Schema deployed.")
