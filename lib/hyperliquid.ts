import "server-only";

import { midRaw } from "./papertrade/markets";

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

/** The coin's current papertrade mid from HyperCore's book, in units of 1 / priceScale. */
export async function readMidRaw(coin: string, priceScale: number) {
  const res = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "l2Book", coin }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Hyperliquid l2Book returned HTTP ${res.status}`);
  const book = (await res.json()) as { levels?: [{ px: string }[], { px: string }[]] };
  const bid = Number(book.levels?.[0]?.[0]?.px);
  const ask = Number(book.levels?.[1]?.[0]?.px);
  // Like the price header, skip a book papertrade wouldn't price at.
  if (!(bid > 0) || !(ask > 0) || ask < bid) throw new Error(`Hyperliquid has no usable ${coin} book`);
  return midRaw(bid, ask, priceScale);
}
