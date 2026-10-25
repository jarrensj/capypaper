import "server-only";

import { cacheLife } from "next/cache";
import { isAddress, type Address } from "viem";
import { formatPercent } from "../format";
import { PAPERTRADE_URL, USER_AGENT } from "./config";

export type BuilderFee = {
  /** capypaper's builder address, lowercase. */
  address: Address;
  /** e.g. "0.5%" */
  rate: string;
};

/**
 * capypaper's papertrade builder code, for session keys to name as their fee
 * address so the closes they sign pay capypaper the builder fee. Null when
 * PAPERTRADE_BUILDER_ADDRESS isn't set, papertrade doesn't approve it right now
 * or papertrade can't be reached, since papertrade refuses a registration that
 * names an unapproved builder.
 */
// TODO: cover the builder fee in the Terms of Service once capypaper has one.
export async function builderFee(): Promise<BuilderFee | null> {
  try {
    return await approvedBuilderFee();
  } catch {
    // A cached function that throws stores nothing, so the next call asks
    // papertrade again rather than skipping the builder for a minute.
    return null;
  }
}

async function approvedBuilderFee(): Promise<BuilderFee | null> {
  "use cache";
  // Rechecked about once a minute, so a builder papertrade removes stops being
  // named soon after.
  cacheLife("minutes");

  const address = process.env.PAPERTRADE_BUILDER_ADDRESS?.toLowerCase();
  if (!address) return null;
  if (!isAddress(address)) {
    console.error("PAPERTRADE_BUILDER_ADDRESS isn't an address; registering keys without a builder");
    return null;
  }

  const [stats, board] = await Promise.all([
    getJson(`/query/builders/${address}/stats`),
    getJson("/query/builders/leaderboard"),
  ]);
  if (stats.address !== address || stats.approved !== true) return null;
  if (typeof board.feeRateRaw !== "string") return null;
  return { address, rate: formatPercent(BigInt(board.feeRateRaw)) };
}

async function getJson(path: string) {
  const res = await fetch(PAPERTRADE_URL + path, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}
