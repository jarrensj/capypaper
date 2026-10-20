"use server";

import { parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decryptSessionKey } from "@/lib/crypto";
import { readAccount } from "@/lib/papertrade/account";
import { signIntent } from "@/lib/papertrade/intents";
import { MARKETS } from "@/lib/papertrade/markets";
import { relayerErrorMessage, submitIntent } from "@/lib/papertrade/relayer";
import { currentSession, reserveNonce } from "@/lib/session";

// Short deadlines so an order stuck in the relayer's queue doesn't fill long
// after the price it was placed at.
const OPEN_DEADLINE_SEC = 60;
const CLOSE_DEADLINE_SEC = 300;
const MAX_LEVERAGE = 1000;
// The relayer takes at most this many positions per close.
const MAX_CLOSE_IDS = 12;

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

  const signed = await signIntent(key.signer, "OpenPosition", {
    user: key.wallet,
    instrumentId: market.instrumentId,
    isLong: order.isLong,
    size: parseUnits(order.margin, 18),
    leverage: order.leverage,
    useDebt: false,
    nonce: await reserveNonce(key.wallet),
    deadline: deadline(OPEN_DEADLINE_SEC),
  });
  try {
    return { ok: true, intentId: (await submitIntent("openPosition", signed)) ?? null };
  } catch (error) {
    return { ok: false, error: relayerErrorMessage(error) };
  }
}

/** Closes positions in full; papertrade doesn't do partial closes. */
export async function closePositions(positionIds: string[]): Promise<Result<object>> {
  if (positionIds.length < 1 || positionIds.length > MAX_CLOSE_IDS) {
    return { ok: false, error: `Close between 1 and ${MAX_CLOSE_IDS} positions at a time.` };
  }

  const key = await tradingKey(CLOSE_DEADLINE_SEC);
  if (!key.ok) return key;
  const open = new Set(key.openPositionIds);
  if (!positionIds.every((id) => open.has(id))) {
    return { ok: false, error: "That position is already closed. Refresh to see your positions." };
  }

  const signed = await signIntent(key.signer, "Close", {
    user: key.wallet,
    positionIds: positionIds.map(BigInt),
    nonce: await reserveNonce(key.wallet),
    deadline: deadline(CLOSE_DEADLINE_SEC),
  });
  try {
    await submitIntent("closePositions", signed);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: relayerErrorMessage(error) };
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
    openPositionIds: account.openPositions.map((p) => p.positionId),
  };
}

function deadline(seconds: number) {
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}
