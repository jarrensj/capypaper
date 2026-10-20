"use server";

import { refresh } from "next/cache";
import { parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decryptSessionKey } from "@/lib/crypto";
import { readAccount } from "@/lib/papertrade/account";
import { signIntent } from "@/lib/papertrade/intents";
import { MARKETS } from "@/lib/papertrade/markets";
import { relayerErrorMessage, submitIntent } from "@/lib/papertrade/relayer";
import { currentSession, reserveNonce } from "@/lib/session";
import { recordTrade, settleTrades } from "@/lib/trades";

// Short deadlines so an order stuck in the relayer's queue doesn't fill long
// after the price it was placed at.
const OPEN_DEADLINE_SEC = 60;
const CLOSE_DEADLINE_SEC = 300;
const MAX_LEVERAGE = 1000;

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export async function openPosition(order: {
  coin: string;
  isLong: boolean;
  /** USD, e.g. "25" or "12.50". */
  margin: string;
  leverage: number;
}): Promise<Result<{ intentId: string | null }>> {
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

  const size = parseUnits(order.margin, 18);
  const orderDeadline = deadline(OPEN_DEADLINE_SEC);
  const { signed, intentId } = await signIntent(key.signer, "OpenPosition", {
    user: key.wallet,
    instrumentId: market.instrumentId,
    isLong: order.isLong,
    size,
    leverage: order.leverage,
    useDebt: false,
    nonce: await reserveNonce(key.wallet),
    deadline: orderDeadline,
  });
  let accepted: string;
  try {
    accepted = (await submitIntent("openPosition", signed)) ?? intentId;
  } catch (error) {
    return { ok: false, error: relayerErrorMessage(error) };
  }
  await logTrade({
    intentId: accepted,
    wallet: key.wallet,
    kind: "open",
    instrumentId: market.instrumentId,
    isLong: order.isLong,
    marginRaw: size,
    leverage: order.leverage,
    deadline: new Date(Number(orderDeadline) * 1000),
  });
  return { ok: true, intentId: accepted };
}

/** Closes a position in full; papertrade doesn't do partial closes. */
export async function closePosition(positionId: string): Promise<Result<object>> {
  const key = await tradingKey(CLOSE_DEADLINE_SEC);
  if (!key.ok) return key;
  const position = key.openPositions.find((p) => p.positionId === positionId);
  if (!position) {
    return { ok: false, error: "That position is already closed. Refresh to see your positions." };
  }

  const orderDeadline = deadline(CLOSE_DEADLINE_SEC);
  const { signed, intentId } = await signIntent(key.signer, "Close", {
    user: key.wallet,
    positionIds: [BigInt(positionId)],
    nonce: await reserveNonce(key.wallet),
    deadline: orderDeadline,
  });
  let accepted: string;
  try {
    accepted = (await submitIntent("closePositions", signed)) ?? intentId;
  } catch (error) {
    return { ok: false, error: relayerErrorMessage(error) };
  }
  await logTrade({
    intentId: accepted,
    wallet: key.wallet,
    kind: "close",
    instrumentId: position.instrumentId,
    isLong: position.isLong,
    marginRaw: position.marginRaw,
    leverage: position.leverage,
    positionId,
    deadline: new Date(Number(orderDeadline) * 1000),
  });
  return { ok: true };
}

/** Settles the signed-in wallet's logged trades against its account, then refreshes the page. */
export async function syncAccount() {
  const session = await currentSession();
  const account = session && (await readAccount(session.wallet).catch(() => null));
  if (session && account) await settleTrades(session.wallet, account);
  refresh();
}

/** The order is already with papertrade, so a logging failure mustn't fail the request. */
async function logTrade(trade: Parameters<typeof recordTrade>[0]) {
  try {
    await recordTrade(trade);
  } catch (error) {
    console.error("couldn't log trade", trade.intentId, error);
  }
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

  const privateKey = decryptSessionKey(session.encryptedSessionKey, session.wallet);
  if (!privateKey) {
    return { ok: false as const, error: "Couldn't unlock your session key. Disconnect, then connect again." };
  }
  return {
    ok: true as const,
    wallet: session.wallet as Hex,
    signer: privateKeyToAccount(privateKey as Hex),
    openPositions: account.openPositions,
  };
}

function deadline(seconds: number) {
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}
