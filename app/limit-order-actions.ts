"use server";

import { refresh } from "next/cache";
import { formatUnits } from "viem";
import { readMidRaw } from "@/lib/hyperliquid";
import {
  cancelLimitOrder as cancelOrder,
  claimLimitOrder,
  createLimitOrder,
  finishLimitOrder,
  pendingLimitOrders,
} from "@/lib/limit-orders";
import { limitReached, parseLimitPrice } from "@/lib/limit-price";
import { parseOpenOrder, type OpenOrder } from "@/lib/open-order";
import { readAccount } from "@/lib/papertrade/account";
import { MARKETS } from "@/lib/papertrade/markets";
import { currentSession } from "@/lib/session";
import { closePosition, openPosition } from "./trade-actions";

type Result = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Saves a limit order to open a position once the price reaches `limitPrice`. */
export async function placeLimitOpen(order: OpenOrder & { limitPrice: string }): Promise<Result> {
  const session = await currentSession();
  if (!session) return { ok: false, error: "Connect your wallet first." };
  const parsed = parseOpenOrder(order);
  if (!parsed.ok) return parsed;
  const limitPriceRaw = parseLimitPrice(order.limitPrice, parsed.market.priceScale);
  if (limitPriceRaw === null) return { ok: false, error: limitPriceError(parsed.market.priceScale) };

  const saved = await createLimitOrder(session.wallet, {
    kind: "open",
    instrumentId: parsed.market.instrumentId,
    isLong: order.isLong,
    marginRaw: parsed.size,
    leverage: order.leverage,
    limitPriceRaw,
  });
  if (!saved) return { ok: false, error: "You have too many limit orders waiting. Cancel one first." };
  refresh();
  return { ok: true };
}

/** Saves a limit order to close a position once the price reaches `limitPrice`, replacing any earlier one. */
export async function placeLimitClose(positionId: string, limitPrice: string): Promise<Result> {
  const session = await currentSession();
  if (!session) return { ok: false, error: "Connect your wallet first." };
  const account = await readAccount(session.wallet).catch(() => null);
  if (!account) return { ok: false, error: "Couldn't reach papertrade. Try again in a minute." };
  const position = account.openPositions.find((p) => p.positionId === positionId);
  const market = position && MARKETS.find((m) => m.instrumentId === position.instrumentId);
  if (!position || !market) {
    return { ok: false, error: "That position is already closed. Refresh to see your positions." };
  }
  const limitPriceRaw = parseLimitPrice(limitPrice, market.priceScale);
  if (limitPriceRaw === null) return { ok: false, error: limitPriceError(market.priceScale) };

  const saved = await createLimitOrder(session.wallet, {
    kind: "close",
    instrumentId: position.instrumentId,
    isLong: position.isLong,
    marginRaw: position.marginRaw,
    leverage: position.leverage,
    positionId,
    limitPriceRaw,
  });
  if (!saved) return { ok: false, error: "You have too many limit orders waiting. Cancel one first." };
  refresh();
  return { ok: true };
}

export async function cancelLimitOrder(id: string) {
  const session = await currentSession();
  if (session && UUID.test(id)) await cancelOrder(session.wallet, id);
  refresh();
}

/**
 * Places the signed-in wallet's pending limit orders whose limit the current price
 * has reached. The page calls this when its price stream shows a limit reached; the
 * price is checked again here, from HyperCore's book.
 */
export async function fireLimitOrders() {
  const session = await currentSession();
  if (!session) return;
  const mids = new Map<number, number | null>();
  for (const order of await pendingLimitOrders(session.wallet)) {
    const market = MARKETS.find((m) => m.instrumentId === order.instrumentId);
    if (!market) continue;
    if (!mids.has(market.instrumentId)) {
      mids.set(market.instrumentId, await readMidRaw(market.coin, market.priceScale).catch(() => null));
    }
    const mid = mids.get(market.instrumentId);
    if (mid == null || !limitReached(order, mid)) continue;
    // Claim it first, so another tab firing the same order can't place it twice.
    if (!(await claimLimitOrder(order.id))) continue;

    const placed = await (order.kind === "open"
      ? openPosition({
          coin: market.coin,
          isLong: order.isLong,
          margin: formatUnits(order.marginRaw, 18),
          leverage: order.leverage,
        })
      : closePosition(order.positionId!)
    ).catch((error) => {
      console.error("couldn't place limit order", order.id, error);
      return { ok: false as const, error: "Couldn't place the order." };
    });
    await finishLimitOrder(order.id, placed);
  }
  refresh();
}

function limitPriceError(priceScale: number) {
  const digits = Math.round(Math.log10(priceScale));
  return `Enter the limit price in USD, with up to ${digits} decimal${digits === 1 ? "" : "s"}.`;
}
