import { parseUnits } from "viem";

type LimitSide = { kind: "open" | "close"; isLong: boolean };

/** Whether a limit order buys: it opens a long or closes a short. */
export function isBuy(order: LimitSide) {
  return order.kind === "open" ? order.isLong : !order.isLong;
}

/**
 * Whether the mid has reached the order's limit: at or below it for a buy, at or
 * above it for a sell. Both are in units of 1 / the market's priceScale.
 */
export function limitReached(order: LimitSide & { limitPriceRaw: number }, midRaw: number) {
  return isBuy(order) ? midRaw <= order.limitPriceRaw : midRaw >= order.limitPriceRaw;
}

/** A USD limit price in units of 1 / priceScale, or null unless it's positive and at the market's precision. */
export function parseLimitPrice(price: string, priceScale: number) {
  const digits = Math.round(Math.log10(priceScale));
  if (!new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`).test(price)) return null;
  const raw = Number(parseUnits(price, digits));
  return raw > 0 && Number.isSafeInteger(raw) ? raw : null;
}
