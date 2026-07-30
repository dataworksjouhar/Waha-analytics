"""POS sales line generator (Source 1, D365 F&O export shape, own-operated
venues). Playground and Farm ticket volume is driven by the footfall
already built at gates G01/G02; gym day passes and equestrian walk-in
package sales run off their own venue seasonality profile instead, since
day-to-day gym/stable visits aren't captured by the park turnstiles.

Clean data only: no duplicate lines, no refunds yet (session 6).

Generates per day in batches (numpy draws sized to that day's transaction
count) rather than one Python-level rng call per transaction; at ~400k
target lines over 731 days, drawing one-at-a-time was too slow.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from generator.calendars import seasonality_factor

_PRODUCTS_DF = pd.read_csv("data/seeds/products.csv")
PRODUCT_INFO = {
    row["product_code"]: (row["product_id"], row["product_name"], row["unit_price_kwd"])
    for _, row in _PRODUCTS_DF.iterrows()
}


def _park_footfall_by_day(footfall: pd.DataFrame, gates: list[str]) -> pd.Series:
    relevant = footfall[footfall["sensor_id"].isin(gates)]
    return relevant.groupby("date")["count_in"].sum()


def _batch_lines(n: int, date, item_codes: np.ndarray, qtys: np.ndarray, payment_modes: np.ndarray,
                  hours: np.ndarray, minutes: np.ndarray, site_id: str, location_id: str,
                  invoice_start: int) -> pd.DataFrame:
    if n == 0:
        return pd.DataFrame()
    invoice_ids = np.array([f"INV{i:08d}" for i in range(invoice_start, invoice_start + n)])
    prices = np.array([PRODUCT_INFO[c][2] for c in item_codes])
    item_ids = np.array([PRODUCT_INFO[c][0] for c in item_codes])
    item_names = np.array([PRODUCT_INFO[c][1] for c in item_codes])
    invoice_dts = pd.Timestamp(date) + pd.to_timedelta(hours, unit="h") + pd.to_timedelta(minutes, unit="m")

    return pd.DataFrame(
        {
            "INVOICEID": invoice_ids,
            "SALESID": invoice_ids,
            "INVOICEDATE": date,
            "ITEMID": item_ids,
            "ITEMNAME": item_names,
            "QTY": qtys,
            "SALESPRICE": prices,
            "LINEAMOUNT": (qtys * prices).round(3),
            "CURRENCYCODE": "KWD",
            "INVENTSITEID": site_id,
            "INVENTLOCATIONID": location_id,
            "CUSTACCOUNT": "WALKIN",
            "PAYMENTMODE": payment_modes,
            "CREATEDDATETIME": invoice_dts,
        }
    )


def build_pos_sales(date_spine: pd.DataFrame, footfall: pd.DataFrame, config: dict, rng: np.random.Generator) -> pd.DataFrame:
    pcfg = config["pos"]
    park_footfall = _park_footfall_by_day(footfall, pcfg["gates_feeding_park_venues"])
    payment_names = np.array(list(pcfg["payment_mode_mix"].keys()))
    payment_probs = list(pcfg["payment_mode_mix"].values())

    gym_factors = seasonality_factor(date_spine["full_date"], "gym", config)
    eq_factors = seasonality_factor(date_spine["full_date"], "equestrian_lessons", config)

    chunks: list[pd.DataFrame] = []
    invoice_counter = 0

    for i, day in date_spine.iterrows():
        date = day["full_date"].date()
        day_footfall = park_footfall.get(date, 0)
        noise = rng.normal(1.0, pcfg["basket_noise_std_pct"])

        n_playground = max(round(day_footfall * pcfg["playground"]["ticket_conversion_rate"] * noise), 0)
        n_farm = max(round(day_footfall * pcfg["farm"]["ticket_conversion_rate"] * noise), 0)
        n_gym = max(round(pcfg["gym"]["base_daypasses_per_day"] * gym_factors[i] * noise), 0)
        n_equestrian = rng.poisson(pcfg["equestrian_walkin"]["base_lesson_package_sales_per_day"] * eq_factors[i])

        def hm(n):
            return rng.integers(9, 21, size=n), rng.integers(0, 60, size=n)

        if n_playground:
            hours, minutes = hm(n_playground)
            ticket_mix = pcfg["playground"]["ticket_mix"]
            ticket_types = rng.choice(list(ticket_mix.keys()), size=n_playground, p=list(ticket_mix.values()))
            item_codes = np.array([f"playground_ticket_{t}" for t in ticket_types])
            payments = rng.choice(payment_names, size=n_playground, p=payment_probs)
            chunks.append(_batch_lines(n_playground, date, item_codes, np.ones(n_playground, dtype=int),
                                        payments, hours, minutes, "AWP", "V01", invoice_counter + 1))
            invoice_counter += n_playground

        if n_farm:
            hours, minutes = hm(n_farm)
            farm_mix = pcfg["farm"]["ticket_mix"]
            ticket_types = rng.choice(list(farm_mix.keys()), size=n_farm, p=list(farm_mix.values()))
            item_codes = np.array([f"farm_ticket_{t}" for t in ticket_types])
            payments = rng.choice(payment_names, size=n_farm, p=payment_probs)
            chunks.append(_batch_lines(n_farm, date, item_codes, np.ones(n_farm, dtype=int),
                                        payments, hours, minutes, "AWP", "V02", invoice_counter + 1))
            base_invoice_start = invoice_counter + 1
            invoice_counter += n_farm

            attach = rng.random(n_farm) < pcfg["farm"]["kiosk_attach_rate"]
            n_kiosk = int(attach.sum())
            if n_kiosk:
                kiosk_items = rng.choice(["farm_kiosk_feed_cups", "farm_kiosk_snacks"], size=n_kiosk)
                kiosk_qty = rng.integers(1, 3, size=n_kiosk)
                kiosk_invoice_ids = np.array([f"INV{i:08d}" for i in
                                               (base_invoice_start + np.nonzero(attach)[0])])
                kiosk_prices = np.array([PRODUCT_INFO[c][2] for c in kiosk_items])
                kiosk_df = pd.DataFrame(
                    {
                        "INVOICEID": kiosk_invoice_ids,
                        "SALESID": kiosk_invoice_ids,
                        "INVOICEDATE": date,
                        "ITEMID": [PRODUCT_INFO[c][0] for c in kiosk_items],
                        "ITEMNAME": [PRODUCT_INFO[c][1] for c in kiosk_items],
                        "QTY": kiosk_qty,
                        "SALESPRICE": kiosk_prices,
                        "LINEAMOUNT": (kiosk_qty * kiosk_prices).round(3),
                        "CURRENCYCODE": "KWD",
                        "INVENTSITEID": "AWP",
                        "INVENTLOCATIONID": "V02",
                        "CUSTACCOUNT": "WALKIN",
                        "PAYMENTMODE": rng.choice(payment_names, size=n_kiosk, p=payment_probs),
                        "CREATEDDATETIME": pd.Timestamp(date) + pd.Timedelta(hours=12),
                    }
                )
                chunks.append(kiosk_df)

        if n_gym:
            hours, minutes = hm(n_gym)
            payments = rng.choice(payment_names, size=n_gym, p=payment_probs)
            chunks.append(_batch_lines(n_gym, date, np.full(n_gym, "gym_daypass"), np.ones(n_gym, dtype=int),
                                        payments, hours, minutes, "AWP", "V03", invoice_counter + 1))
            invoice_counter += n_gym

        if n_equestrian:
            hours, minutes = hm(n_equestrian)
            packages = rng.choice(
                ["lesson_package_beginner_4", "lesson_package_intermediate_4", "lesson_package_advanced_4"],
                size=n_equestrian, p=[0.5, 0.3, 0.2],
            )
            payments = rng.choice(payment_names, size=n_equestrian, p=payment_probs)
            chunks.append(_batch_lines(n_equestrian, date, packages, np.ones(n_equestrian, dtype=int),
                                        payments, hours, minutes, "AWP", "V04", invoice_counter + 1))
            invoice_counter += n_equestrian

    return pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame()
