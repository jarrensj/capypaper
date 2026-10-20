import { formatUnits } from "viem";

/** A price with the precision papertrade quotes it at: one decimal per factor of 10 in priceScale. */
export function formatPrice(price: number, priceScale: number) {
  const digits = Math.round(Math.log10(priceScale));
  return price.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** An 18-decimal USD amount, e.g. "$1,234.56". */
export function formatUsd(raw: bigint) {
  return Number(formatUnits(raw, 18)).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
