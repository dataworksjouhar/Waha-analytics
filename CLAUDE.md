# Al Waha Analytics Platform

Full architecture and design decisions: @docs/phase0-architecture.md

## What this project is

A reusable analytics pipeline and reporting template for SMEs in Kuwait, built by Mohammed Jouhar (Senior Business Data Analyst, 12+ years in retail analytics: Alshaya, Lowe's, Tesco, Decathlon).

This repo is the flagship demo: a fictional multi-venue lifestyle destination called **Al Waha Destination Co.**, inspired by (but never branded as) real Kuwaiti operators. Ten leased tenants paying turnover rent, four own-operated venues (Playground, Farm, Pulse Gym, Equestrian Centre), a booking website, D365-shaped ERP exports. All data is synthetic.

Two goals, equally weighted:
1. **Portfolio and interview credibility.** Must demonstrate real warehouse thinking and survive technical questioning.
2. **Template reusability.** A future real client is a config change, not a rewrite.

## Non-negotiable working rules

**Teaching first.** Jouhar is an expert in SQL, Power BI, DAX and retail analytics. He is NOT a software engineer. Explain architecture, Python and DevOps concepts when introducing them. After writing any file, offer a line-by-line explanation. **No code gets committed that he cannot explain in an interview.** Prefer guiding him to type over silently generating large files.

**One template, many configs.** All client-specific values live in `config/`. Never fork logic per client. New source formats become new mappings in the shared library.

**Scope discipline.** No ML, no auth system beyond a managed provider, no dashboards until the pipeline is done and validated. If a new feature is proposed, check it against the phase plan first and push back.

**Data quality is the point.** The synthetic sources contain deliberate imperfections (dead sensor, inconsistent gate names, late and restated tenant submissions, null contract end dates, duplicate member identities, overbooked lessons). These are never quietly dropped. They are detected, flagged, and reported.

**Writing style:** never use em dashes in any content, code comments, or documentation. Use commas, parentheses, colons, or hyphens.

## Stack

- Python 3.12, pandas
- Postgres (Supabase or Neon free tier), schemas: `bronze` (file registry), `silver`, `gold`, `dq`
- Orchestration: `pipeline/run.py`, GitHub Actions later
- No Spark, no dbt, no Airflow, no live D365 connection. Transforms are hand-written on purpose.

## Layout

```
config/      client YAML and schema definitions
generator/   synthetic data generation (run first)
pipeline/    extract, transform, load, dq
sql/         gold views and reporting aggregates
app/         Phase 2 frontend, empty for now
tests/       pytest on transform logic
docs/        architecture doc
```

## Commands

```bash
python generator/generate.py      # builds 2 years of messy bronze files
python pipeline/run.py            # bronze -> silver -> gold + DQ checks
pytest                            # transform tests
```

## Phase 1 definition of done

Both commands run clean from an empty database, DQ results are logged to `dq.check_results`, and the gold layer answers the business questions in section 2.2 of the architecture doc via plain SQL.

## Conventions

- Silver tables carry lineage columns: `_source_file`, `_loaded_at`, `_dq_flags`
- Facts and dims are rebuilt idempotently; re-running must not duplicate rows
- `dim_tenant` is SCD Type 2 (`valid_from`, `valid_to`, `is_current`)
- Deterministic seed in the generator so the demo is reproducible
- Commit after every working session with a descriptive message; the git history is part of the portfolio

## Environment (verified 29 July 2026)

## Environment (verified 29 July 2026)

Python 3.14.6, pandas 3.0.5, numpy 2.5.1, SQLAlchemy 2.0.51, psycopg2-binary 2.9.12.
Windows 11, PowerShell. Repo at C:\Projects\Waha-analytics (deliberately NOT in OneDrive).
Database: Supabase Postgres, ap-south-1 (Mumbai), connected via session pooler on port 5432.

pandas 3.x is current here, not 2.x. Copy-on-write is the default; do not write chained
assignment or rely on removed 2.x methods.

Terminal is PowerShell on Windows: use PowerShell syntax, not bash.