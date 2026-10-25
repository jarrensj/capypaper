import "server-only";

import { PAPERTRADE_URL, USER_AGENT } from "./config";

export type Position = {
  positionId: string;
  instrumentId: number;
  isLong: boolean;
  /** Prices in units of 1 / the market's priceScale. */
  entryPriceRaw: number;
  bustPriceRaw: number;
  /** 18-decimal USD. */
  marginRaw: bigint;
  leverage: number;
  openedAtMs: number;
  /** The intent that opened the position (lowercase). */
  intentId: string;
};

/** An intent the relayer has accepted but that hasn't settled onchain yet. */
export type Operation = {
  intentId: string;
  action: string;
  /** For closePositions, the positions being closed. */
  closeIds: string[];
};

export type Account = {
  /** Registered session key address (lowercase) → expiry in unix seconds. */
  sessionKeys: Map<string, number>;
  /** 18-decimal USD available to open positions with. */
  availableBalance: bigint;
  openPositions: Position[];
  operations: Operation[];
};

/**
 * Reads a wallet's current papertrade account from its public live stream. The
 * stream's first `wallet` event is a full snapshot; later ones are patches, which
 * this doesn't need.
 */
export async function readAccount(
  wallet: string,
  timeoutMs = 10_000,
): Promise<Account> {
  const url = `${PAPERTRADE_URL}/state/user/live?wallet=${encodeURIComponent(wallet.toLowerCase())}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/event-stream", "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`papertrade account stream returned HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const event = parseEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event.name === "wallet") return parseSnapshot(event.data);
      }
    }
    throw new Error("papertrade account stream ended before sending the account");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function parseEvent(block: string) {
  let name = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return { name, data: data.join("\n") };
}

type PositionTuple = [string, number, boolean, boolean, string, string, number, string, number, string];
type OperationTuple = [string, string, ...unknown[]];

function parseSnapshot(json: string): Account {
  const snapshot = JSON.parse(json) as {
    sessionKeys?: [string, string][];
    funds?: { availableBalance?: string };
    openPositions?: PositionTuple[];
    operations?: OperationTuple[];
  };
  return {
    sessionKeys: new Map(
      (snapshot.sessionKeys ?? []).map(([key, expiry]) => [
        key.toLowerCase(),
        Number(expiry),
      ]),
    ),
    availableBalance: BigInt(snapshot.funds?.availableBalance ?? "0"),
    openPositions: (snapshot.openPositions ?? []).map(
      ([positionId, instrumentId, isLong, , entryPriceRaw, marginRaw, leverage, bustPriceRaw, openedAtMs, intentId]) => ({
        positionId,
        instrumentId,
        isLong,
        entryPriceRaw: Number(entryPriceRaw),
        bustPriceRaw: Number(bustPriceRaw),
        marginRaw: BigInt(marginRaw),
        leverage,
        openedAtMs,
        intentId: String(intentId).toLowerCase(),
      }),
    ),
    // [intentId, action, instrumentId, isLong, useDebt, amount, leverage, acceptedAtMs, deadline, closeIds]
    operations: (snapshot.operations ?? []).map((op) => ({
      intentId: op[0].toLowerCase(),
      action: op[1],
      closeIds: Array.isArray(op[9]) ? op[9].map(String) : [],
    })),
  };
}
