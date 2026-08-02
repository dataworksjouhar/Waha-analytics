"""The single pipeline entry point: schema, bronze, silver, gold, with a
DQ gate after silver and another after gold. This is what the architecture
doc's Phase 1 definition of done means by "python pipeline/run.py builds
silver and gold in Postgres with DQ results recorded."

Two gates, not one at the very end:
- After silver: pipeline.dq.checks.run_silver_checks (business-key
  dedup correctness, source freshness). These only need silver, so
  there's no reason to wait until gold exists to catch them - and a
  broken silver load is exactly the kind of thing that should stop the
  run before gold spends minutes rebuilding facts from bad input.
- After gold: pipeline.dq.checks.run_gold_checks (row-count reconciliation,
  uniqueness on the gold keys, referential integrity, value ranges).

A gate only actually stops the run on an error-severity failure
(uniqueness or referential integrity - see pipeline/dq/checks.py's
docstring for why those two are the ones that should never legitimately
fail). Warning-severity failures (row_count, value_range, freshness) are
printed in the summary but never block progress, since those can drift a
little without anything being broken.

Both bronze extract and every silver/gold load are independently
idempotent (bronze dedupes on checksum, silver/gold truncate-and-reload
each run), so re-running this end to end never duplicates a row - that's
what "idempotent" in the Phase 1 definition of done is actually resting on,
not anything this orchestrator itself has to enforce.

    python -m pipeline.run
"""

from __future__ import annotations

import sys
import time
import uuid

from pipeline.db import get_engine
from pipeline.dq import checks as dq
from pipeline.extract import bronze_extract, deploy_schema
from pipeline.load import run_gold_dims, run_gold_facts
from pipeline.transform import run_silver_messy, run_silver_structured
from pipeline.util import load_config


def _stage(label: str):
    print(f"\n=== {label} ===")
    return time.time()


def run() -> bool:
    """Returns True if the run finished without an error-severity DQ
    failure, False otherwise. See __main__ for how that becomes an exit
    code."""
    engine = get_engine()
    config = load_config()
    run_id = str(uuid.uuid4())
    t_run_start = time.time()

    t0 = _stage("Schema")
    deploy_schema.deploy_schema(engine)
    print(f"  deployed ({time.time() - t0:.1f}s)")

    t0 = _stage("Bronze extract")
    for name, n in bronze_extract.extract_all(engine).items():
        print(f"  {name}: {n} rows")
    print(f"  ({time.time() - t0:.1f}s)")

    t0 = _stage("Silver")
    run_silver_structured.run(engine)
    run_silver_messy.run(engine)
    print(f"  ({time.time() - t0:.1f}s)")

    t0 = _stage("DQ gate: silver")
    silver_dq = dq.run_silver_checks(engine, config, run_id)
    print(dq.summarize(silver_dq))
    print(f"  ({time.time() - t0:.1f}s)")
    if dq.has_critical_failures(silver_dq):
        print("\nABORTING before gold: silver failed an error-severity DQ check.")
        return False

    t0 = _stage("Gold dimensions")
    run_gold_dims.run(engine)
    print(f"  ({time.time() - t0:.1f}s)")

    t0 = _stage("Gold facts")
    run_gold_facts.run(engine)
    print(f"  ({time.time() - t0:.1f}s)")

    t0 = _stage("DQ gate: gold")
    gold_dq = dq.run_gold_checks(engine, run_id)
    print(dq.summarize(gold_dq))
    print(f"  ({time.time() - t0:.1f}s)")

    total_checks = len(silver_dq) + len(gold_dq)
    total_failed = int((silver_dq["status"] == "fail").sum() + (gold_dq["status"] == "fail").sum())
    ok = not dq.has_critical_failures(gold_dq)

    print(f"\n=== Summary ===")
    print(f"run_id: {run_id}")
    print(f"Total time: {time.time() - t_run_start:.1f}s")
    print(f"DQ checks: {total_checks} run, {total_failed} failed")
    print("Result: " + ("PASS" if ok else "FAIL (error-severity DQ check failed in gold)"))

    return ok


if __name__ == "__main__":
    success = run()
    sys.exit(0 if success else 1)
