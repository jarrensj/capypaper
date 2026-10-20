import "server-only";

import { PAPERTRADE_URL, USER_AGENT } from "./config";

export type Account = {
  /** Registered session key address (lowercase) → expiry in unix seconds. */
  sessionKeys: Map<string, number>;
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

function parseSnapshot(json: string): Account {
  const snapshot = JSON.parse(json) as { sessionKeys?: [string, string][] };
  return {
    sessionKeys: new Map(
      (snapshot.sessionKeys ?? []).map(([key, expiry]) => [
        key.toLowerCase(),
        Number(expiry),
      ]),
    ),
  };
}
