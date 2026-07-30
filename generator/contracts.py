"""Membership and boarding contracts generator (Source 7). Gym memberships,
equestrian club memberships and horse boarding share one structure, because
they are the same pattern: member-month recurring revenue with churn.

Simulated as a month-by-month cohort: each month some active contracts
churn and some new ones start, so tenure varies naturally rather than being
hardcoded. Still-active contracts get a null end_date, since that's simply
what "open-ended" means; the genuine data errors (cancellation before start,
duplicate member identity across systems) are session 6's job.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _month_starts(config: dict) -> pd.DatetimeIndex:
    start = config["generator"]["date_range"]["start"]
    end = config["generator"]["date_range"]["end"]
    return pd.date_range(start=start, end=end, freq="MS")


class _MemberIdPool:
    def __init__(self, start: int):
        self._next = start

    def new(self) -> str:
        member_id = f"MBR{self._next:06d}"
        self._next += 1
        return member_id


def _simulate_open_ended(
    contract_type: str, venue_id: str, cfg: dict, months: pd.DatetimeIndex,
    rng: np.random.Generator, member_pool: _MemberIdPool, contract_counter: list[int],
    stable_pool: list[str] | None = None,
) -> list[dict]:
    """Shared churn/intake loop for gym_monthly, equestrian_club and
    horse_boarding: all three are open-ended member-month contracts that
    differ only in target population, churn rate and (for boarding) a
    capacity cap."""
    target_active = cfg["target_active"]
    churn_rate = cfg["monthly_churn_rate"]
    base_new_starts = target_active * churn_rate
    jan_multiplier = cfg.get("january_intake_multiplier", 1.0)

    active: list[dict] = []
    rows: list[dict] = []

    # Seed pre-existing members so the population starts near steady state
    # rather than ramping up from zero: the park opened in 2023 and this
    # generator's visible window starts mid-2024, so day one should already
    # look like an established membership base. Staggered past start dates
    # (mean tenure 1/churn_rate) give a believable spread of anniversaries
    # instead of everyone joining on the same day.
    mean_tenure_days = min(30 / churn_rate, 900) if churn_rate > 0 else 900
    seed_count = min(target_active, len(stable_pool)) if stable_pool is not None else target_active
    seed_boxes = list(stable_pool[:seed_count]) if stable_pool is not None else [None] * seed_count
    for box in seed_boxes:
        contract_counter[0] += 1
        tenure_days = int(rng.exponential(mean_tenure_days))
        contract = {
            "contract_id": f"CTR{contract_counter[0]:06d}",
            "member_id": member_pool.new(),
            "contract_type": contract_type,
            "venue_id": venue_id,
            "start_date": months[0] - pd.Timedelta(days=tenure_days + 1),
            "end_date": None,
            "monthly_amount_kwd": cfg["monthly_amount_kwd"],
            "status": "active",
            "cancellation_date": None,
            "stable_id": box,
        }
        active.append(contract)
        rows.append(contract)

    for month_start in months:
        month_end = month_start + pd.offsets.MonthEnd(0)

        churners = [c for c in active if rng.random() < churn_rate]
        for c in churners:
            c["end_date"] = month_end
            c["status"] = "cancelled"
            c["cancellation_date"] = month_end
            active.remove(c)

        # Pure independent churn/intake draws random-walk away from target at
        # small population sizes (horse boarding, ~17 boxes); a mild
        # proportional correction keeps population near target without
        # removing month-to-month randomness, which is what "flat" boarding
        # revenue actually looks like rather than a slow drift.
        gap = target_active - len(active)
        expected_new = base_new_starts * (jan_multiplier if month_start.month == 1 else 1.0) + max(gap, 0) * 0.5
        n_new = rng.poisson(max(expected_new, 0))

        if stable_pool is not None:
            free_boxes = [s for s in stable_pool if s not in {c["stable_id"] for c in active}]
            n_new = min(n_new, len(free_boxes))

        for i in range(n_new):
            contract_counter[0] += 1
            contract = {
                "contract_id": f"CTR{contract_counter[0]:06d}",
                "member_id": member_pool.new(),
                "contract_type": contract_type,
                "venue_id": venue_id,
                "start_date": month_start,
                "end_date": None,
                "monthly_amount_kwd": cfg["monthly_amount_kwd"],
                "status": "active",
                "cancellation_date": None,
                "stable_id": free_boxes[i] if stable_pool is not None else None,
            }
            active.append(contract)
            rows.append(contract)

    for c in active:
        c["status"] = "active"

    return rows


def _simulate_annual(cfg: dict, months: pd.DatetimeIndex, rng: np.random.Generator,
                      member_pool: _MemberIdPool, contract_counter: list[int]) -> list[dict]:
    target_active = cfg["target_active"]
    term_months = cfg["term_months"]
    # Replenish only the share that DOESN'T renew each term; new_per_month =
    # target/term_months would replace the entire population every year on
    # top of renewals, drifting active count well past target.
    new_per_month = target_active * (1 - cfg["renewal_probability"]) / term_months

    active: list[dict] = []  # each: member_id, current contract dict, term_end (Timestamp)
    rows: list[dict] = []

    # Seed pre-existing annual members with staggered term-end dates spread
    # across the coming term, rather than starting at zero and ramping up.
    for _ in range(target_active):
        contract_counter[0] += 1
        days_into_term = int(rng.uniform(0, term_months * 30))
        term_end = months[0] + pd.DateOffset(days=(term_months * 30 - days_into_term))
        start_date = term_end - pd.DateOffset(months=term_months) + pd.Timedelta(days=1)
        contract = {
            "contract_id": f"CTR{contract_counter[0]:06d}",
            "member_id": member_pool.new(),
            "contract_type": "gym_annual",
            "venue_id": "V03",
            "start_date": start_date,
            "end_date": None,
            "monthly_amount_kwd": cfg["monthly_amount_kwd"],
            "status": "active",
            "cancellation_date": None,
            "stable_id": None,
        }
        rows.append(contract)
        active.append({"member_id": contract["member_id"], "contract": contract, "term_end": term_end})

    for month_start in months:
        # renewals / expiries for contracts whose term ends this month
        still_active = []
        for entry in active:
            if entry["term_end"].to_period("M") == month_start.to_period("M"):
                entry["contract"]["end_date"] = entry["term_end"]
                if rng.random() < cfg["renewal_probability"]:
                    contract_counter[0] += 1
                    new_term_end = entry["term_end"] + pd.DateOffset(months=term_months)
                    new_contract = {
                        "contract_id": f"CTR{contract_counter[0]:06d}",
                        "member_id": entry["member_id"],
                        "contract_type": "gym_annual",
                        "venue_id": "V03",
                        "start_date": entry["term_end"] + pd.Timedelta(days=1),
                        "end_date": None,
                        "monthly_amount_kwd": cfg["monthly_amount_kwd"],
                        "status": "active",
                        "cancellation_date": None,
                        "stable_id": None,
                    }
                    rows.append(new_contract)
                    still_active.append({"member_id": entry["member_id"], "contract": new_contract, "term_end": new_term_end})
                else:
                    entry["contract"]["status"] = "expired"
            else:
                still_active.append(entry)
        active = still_active

        n_new = rng.poisson(max(new_per_month, 0))
        for _ in range(n_new):
            contract_counter[0] += 1
            term_end = month_start + pd.DateOffset(months=term_months) - pd.Timedelta(days=1)
            contract = {
                "contract_id": f"CTR{contract_counter[0]:06d}",
                "member_id": member_pool.new(),
                "contract_type": "gym_annual",
                "venue_id": "V03",
                "start_date": month_start,
                "end_date": None,
                "monthly_amount_kwd": cfg["monthly_amount_kwd"],
                "status": "active",
                "cancellation_date": None,
                "stable_id": None,
            }
            rows.append(contract)
            active.append({"member_id": contract["member_id"], "contract": contract, "term_end": term_end})

    return rows


def build_contracts(config: dict, rng: np.random.Generator) -> pd.DataFrame:
    ccfg = config["contracts"]
    months = _month_starts(config)
    member_pool = _MemberIdPool(ccfg["new_member_id_start"])
    contract_counter = [0]

    stables = pd.read_csv("data/seeds/stables.csv")
    stable_ids = stables["stable_id"].tolist()

    rows: list[dict] = []
    rows += _simulate_open_ended("gym_monthly", "V03", ccfg["gym_monthly"], months, rng, member_pool, contract_counter)
    rows += _simulate_annual(ccfg["gym_annual"], months, rng, member_pool, contract_counter)
    rows += _simulate_open_ended("equestrian_club", "V04", ccfg["equestrian_club"], months, rng, member_pool, contract_counter)
    rows += _simulate_open_ended(
        "horse_boarding", "V04", ccfg["horse_boarding"], months, rng, member_pool, contract_counter, stable_pool=stable_ids
    )

    df = pd.DataFrame(rows)
    df["start_date"] = pd.to_datetime(df["start_date"]).dt.date
    df["end_date"] = pd.to_datetime(df["end_date"]).dt.date
    df["cancellation_date"] = pd.to_datetime(df["cancellation_date"]).dt.date
    return df
