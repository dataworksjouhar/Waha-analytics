"""Combined gold entry point: dims, then facts, in one pass.

Why this has to exist rather than just running run_gold_dims then
run_gold_facts by hand: every fact table's FK now points at a dimension
(session 11), so replace_table's TRUNCATE ... CASCADE on any dimension
reload wipes every fact row that referenced it - Postgres refuses a plain
TRUNCATE against a table with a live FK pointing at it, cascade is the
only way to reload a dimension at all. That was harmless through session
10 because facts were still empty either way; it stops being harmless the
moment facts have rows. So dims can no longer be reloaded on their own in
normal operation - this module is the one that should actually get run,
and run_gold_dims / run_gold_facts stay callable individually only for
debugging a single layer against data you're about to fully rebuild anyway.

    python -m pipeline.load.run_gold
"""

from __future__ import annotations

from pipeline.db import get_engine
from pipeline.load import run_gold_dims, run_gold_facts


def run() -> None:
    engine = get_engine()
    print("=== Gold dimensions ===")
    run_gold_dims.run(engine)
    print("=== Gold facts ===")
    run_gold_facts.run(engine)


if __name__ == "__main__":
    run()
