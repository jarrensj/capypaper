"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { parseUnits } from "viem";
import { copyClose, copyOpen, isListedTrader } from "@/lib/copy-trading";
import { CLOSE_DEADLINE_SEC, OPEN_DEADLINE_SEC, orderSigner, placeClose, placeOpen } from "@/lib/orders";
import { readAccount } from "@/lib/papertrade/account";
import { MARKETS } from "@/lib/papertrade/markets";
import { currentSession } from "@/lib/session";
import { settleTrades } from "@/lib/trades";

const MAX_LEVERAGE = 1000;

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export async function openPosition(order: {
  coin: string;
  isLong: boolean;
  /** USD, e.g. "25" or "12.50". */
  margin: string;
  leverage: number;
}): Promise<Result<{ intentId: string }>> {
  const market = MARKETS.find(({ coin }) => coin === order.coin);
  if (!market) return { ok: false, error: "Pick BTC or ETH." };
  if (!/^\d+(\.\d{1,6})?$/.test(order.margin) || Number(order.margin) <= 0) {
    return { ok: false, error: "Enter the margin in USD, like 25 or 12.50." };
  }
  if (!Number.isInteger(order.leverage) || order.leverage < 1 || order.leverage > MAX_LEVERAGE) {
    return { ok: false, error: `Leverage must be a whole number from 1 to ${MAX_LEVERAGE}.` };
  }

  const key = await tradingKey(OPEN_DEADLINE_SEC);
  if (!key.ok) return key;
  const open = {
    instrumentId: market.instrumentId,
    isLong: order.isLong,
    size: parseUnits(order.margin, 18),
    leverage: order.leverage,
  };
  const placed = await placeOpen(key, open);
  if (placed.ok && (await isListedTrader(key.wallet))) {
    after(() => copyOpen(key.wallet, placed.intentId, open));
  }
  return placed;
}

/** Closes a position in full; papertrade doesn't do partial closes. */
export async function closePosition(positionId: string): Promise<Result<object>> {
  const key = await tradingKey(CLOSE_DEADLINE_SEC);
  if (!key.ok) return key;
  const position = key.openPositions.find((p) => p.positionId === positionId);
  if (!position) {
    return { ok: false, error: "That position is already closed. Refresh to see your positions." };
  }

  const placed = await placeClose(key, position);
  if (placed.ok && (await isListedTrader(key.wallet))) {
    after(() => copyClose(position.intentId, placed.intentId));
  }
  return placed;
}

/** Settles the signed-in wallet's logged trades against its account, then refreshes the page. */
export async function syncAccount() {
  const session = await currentSession();
  const account = session && (await readAccount(session.wallet).catch(() => null));
  if (session && account) await settleTrades(session.wallet, account);
  refresh();
}

/** The signed-in wallet's session key, if it stays registered for longer than an intent's deadline. */
async function tradingKey(deadlineSec: number) {
  const session = await currentSession();
  if (!session) return { ok: false as const, error: "Connect your wallet first." };

  const account = await readAccount(session.wallet).catch(() => null);
  if (!account) return { ok: false as const, error: "Couldn't reach papertrade. Try again in a minute." };
  const expiry = account.sessionKeys.get(session.sessionKeyAddress);
  if (expiry === undefined || expiry <= Math.floor(Date.now() / 1000) + deadlineSec) {
    return { ok: false as const, error: "Your session has expired. Renew it to trade." };
  }

  const signer = orderSigner(session.wallet, session.encryptedSessionKey);
  if (!signer) {
    return { ok: false as const, error: "Couldn't unlock your session key. Disconnect, then connect again." };
  }
  return { ok: true as const, ...signer, openPositions: account.openPositions };
}
