"""Shared database connection helper. Reads DATABASE_URL from .env; the
connection string is never hardcoded anywhere in the pipeline.
"""

from __future__ import annotations

import os
import time

import sqlalchemy
from dotenv import load_dotenv


def get_engine() -> sqlalchemy.engine.Engine:
    load_dotenv()
    # pool_pre_ping: check a connection is alive before reuse rather than
    # handing back one the free-tier Supabase pooler has already dropped.
    return sqlalchemy.create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True, pool_recycle=300)


def with_retries(fn, attempts: int = 5):
    """Runs fn() with retries on a transient connection failure: the
    free-tier Supabase pooler drops connections mid-transaction under
    sustained load, refuses a brand new connection outright, and DNS
    lookups for it occasionally blip, all observed across repeated runs
    against it. Backoff grows each attempt, capped at 20s.

    Catches InterfaceError alongside OperationalError: when a mid-COPY
    disconnect happens inside engine.begin()'s transaction block, the
    real OperationalError gets raised first, but the context manager's
    own rollback-on-exit then hits the already-dead connection and raises
    InterfaceError instead - that's what actually propagates out of the
    with block, so a retry that only catches OperationalError misses this
    case entirely (seen live: fact_footfall's load dropped mid-COPY and
    surfaced as InterfaceError, not OperationalError)."""
    last_error = None
    for attempt in range(attempts):
        try:
            return fn()
        except (sqlalchemy.exc.OperationalError, sqlalchemy.exc.InterfaceError) as e:
            last_error = e
            if attempt < attempts - 1:
                time.sleep(min(2 * (attempt + 1), 20))
    raise last_error
