/* Formatting helpers. Currency comes from meta.json rather than a hardcoded
 * "KWD", so a client reporting in AED or GBP needs no code change here.
 * KWD carries three decimal places, not two, which Intl already knows: one
 * more reason to let it do the work rather than hand-rolling a toFixed(2)
 * that would quietly be wrong for this client's own currency. */

/* minimumFractionDigits has to be pinned alongside the maximum, not left
 * to default. Intl derives its default fraction digits from the currency
 * itself, and KWD is one of the three-decimal currencies, so asking for
 * maximumFractionDigits: 0 while the minimum silently defaults to 3
 * throws a RangeError (max below min). Hardcoding 2 would have hidden
 * this until the first client reporting in KWD, which is this one. */
export const formatCurrency = (value: number | null, currency: string, fractionDigits = 0) =>
  value === null
    ? "-"
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(value);

export const formatNumber = (value: number | null, maximumFractionDigits = 0) =>
  value === null ? "-" : new Intl.NumberFormat("en-GB", { maximumFractionDigits }).format(value);

export const formatPercent = (value: number | null, maximumFractionDigits = 1) =>
  value === null ? "-" : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits }).format(value)}%`;

/** "2024-07-01" -> "Jul 24", the season ribbon's month tick. */
export const formatMonthShort = (isoDate: string) => {
  const [year, month] = isoDate.split("-");
  const monthName = new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-GB", {
    month: "short",
  });
  return `${monthName} ${year.slice(2)}`;
};

export const formatMonthLong = (isoDate: string) => {
  const [year, month] = isoDate.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
  });
};
