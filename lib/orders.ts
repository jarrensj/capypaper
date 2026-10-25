import "server-only";

import type { Hex, LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decryptSessionKey } from "./crypto";
import type { Position } from "./papertrade/account";
import { signIntent } from "./papertrade/intents";
import { relayerErrorMessage, submitIntent } from "./papertrade/relayer";
import { reserveNonce } from "./session";
import { recordTrade } from "./trades";

// Short deadlines so an order stuck in the relayer's queue doesn't fill long
// after the price it was placed at.
export const OPEN_DEADLINE_SEC = 60;
export const CLOSE_DEADLINE_SEC = 300;

/** A wallet and its session key, which signs the wallet's orders. */
export type OrderSigner = { wallet: Hex; signer: LocalAccount };

export type Placed = { ok: true; intentId: string } | { ok: false; error: string };

export function orderSigner(wallet: string, encryptedSessionKey: string): OrderSigner | null {
  const privateKey = decryptSessionKey(encryptedSessionKey, wallet);
  return privateKey
    ? { wallet: wallet as Hex, signer: privateKeyToAccount(privateKey as Hex) }
    : null;
}

/**
 * Signs and submits an open, and logs it once papertrade accepts it. A copy
 * (`copiedFrom` set) is logged even when rejected, so its copier can see why.
 */
export async function placeOpen(
  { wallet, signer }: OrderSigner,
  order: { instrumentId: number; isLong: boolean; size: bigint; leverage: number },
  copiedFrom?: string,
): Promise<Placed> {
  const deadline = deadlineIn(OPEN_DEADLINE_SEC);
  const { signed, intentId } = await signIntent(signer, "OpenPosition", {
    user: wallet,
    instrumentId: order.instrumentId,
    isLong: order.isLong,
    size: order.size,
    leverage: order.leverage,
    useDebt: false,
    nonce: await reserveNonce(wallet),
    deadline,
  });
  return submitAndLog("openPosition", signed, intentId, copiedFrom, {
    wallet,
    kind: "open",
    instrumentId: order.instrumentId,
    isLong: order.isLong,
    marginRaw: order.size,
    leverage: order.leverage,
    deadline: new Date(Number(deadline) * 1000),
  });
}

/** Signs and submits a full close of `position`, logging it like placeOpen. */
export async function placeClose(
  { wallet, signer }: OrderSigner,
  position: Position,
  copiedFrom?: string,
): Promise<Placed> {
  const deadline = deadlineIn(CLOSE_DEADLINE_SEC);
  const { signed, intentId } = await signIntent(signer, "Close", {
    user: wallet,
    positionIds: [BigInt(position.positionId)],
    nonce: await reserveNonce(wallet),
    deadline,
  });
  return submitAndLog("closePositions", signed, intentId, copiedFrom, {
    wallet,
    kind: "close",
    instrumentId: position.instrumentId,
    isLong: position.isLong,
    marginRaw: position.marginRaw,
    leverage: position.leverage,
    positionId: position.positionId,
    deadline: new Date(Number(deadline) * 1000),
  });
}

async function submitAndLog(
  action: "openPosition" | "closePositions",
  signed: Record<string, unknown>,
  intentId: Hex,
  copiedFrom: string | undefined,
  trade: Omit<Parameters<typeof recordTrade>[0], "intentId" | "copiedFrom" | "error">,
): Promise<Placed> {
  let placed: Placed;
  try {
    placed = { ok: true, intentId: (await submitIntent(action, signed)) ?? intentId };
  } catch (error) {
    placed = { ok: false, error: relayerErrorMessage(error) };
  }
  if (placed.ok || copiedFrom) {
    // The order is already with papertrade, so a logging failure mustn't fail it.
    await recordTrade({
      ...trade,
      intentId: placed.ok ? placed.intentId : intentId,
      copiedFrom,
      error: placed.ok ? undefined : placed.error,
    }).catch((error) => console.error("couldn't log trade", intentId, error));
  }
  return placed;
}

function deadlineIn(seconds: number) {
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}
