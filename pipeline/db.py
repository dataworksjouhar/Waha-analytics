"""Shared database connection helper. Reads DATABASE_URL from .env; the
connection string is never hardcoded anywhere in the pipeline.
"""

from __future__ import annotations

import os

import sqlalchemy
from dotenv import load_dotenv


def get_engine() -> sqlalchemy.engine.Engine:
    load_dotenv()
    # pool_pre_ping: check a connection is alive before reuse rather than
    # handing back one the free-tier Supabase pooler has already dropped.
    return sqlalchemy.create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True, pool_recycle=300)
