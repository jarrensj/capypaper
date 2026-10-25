import { parseUnits } from "viem";
import { MARKETS } from "./papertrade/markets";

const MAX_LEVERAGE = 1000;

export type OpenOrder = {
  coin: string;
  isLong: boolean;
  /** USD, e.g. "25" or "12.50". */
  margin: string;
  leverage: number;
};

/** Checks an order to open a position, returning its market and its margin as 18-decimal USD. */
export function parseOpenOrder(order: OpenOrder) {
  const market = MARKETS.find(({ coin }) => coin === order.coin);
  if (!market) return { ok: false as const, error: "Pick BTC or ETH." };
  if (!/^\d+(\.\d{1,6})?$/.test(order.margin) || Number(order.margin) <= 0) {
    return { ok: false as const, error: "Enter the margin in USD, like 25 or 12.50." };
  }
  if (!Number.isInteger(order.leverage) || order.leverage < 1 || order.leverage > MAX_LEVERAGE) {
    return { ok: false as const, error: `Leverage must be a whole number from 1 to ${MAX_LEVERAGE}.` };
  }
  return { ok: true as const, market, size: parseUnits(order.margin, 18) };
}
