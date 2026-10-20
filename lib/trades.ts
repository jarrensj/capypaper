import "server-only";

import { sql } from "./db";
import type { Account } from "./papertrade/account";

export type TradeKind = "open" | "close";
export type TradeStatus = "submitted" | "filled" | "not_filled";

export type Trade = {
  intentId: string;
  wallet: string;
  kind: TradeKind;
  instrumentId: number;
  isLong: boolean;
  marginRaw: bigint;
  leverage: number;
  positionId: string | null;
  entryPriceRaw: number | null;
  status: TradeStatus;
  createdAt: Date;
};

/** Logs an order papertrade's relayer accepted. */
export async function recordTrade(trade: {
  intentId: string;
  wallet: string;
  kind: TradeKind;
  instrumentId: number;
  isLong: boolean;
  marginRaw: bigint;
  leverage: number;
  /** Required for closes: the position being closed. */
  positionId?: string;
  deadline: Date;
}) {
  await sql`
    insert into trades (
      intent_id, wallet_address, kind, instrument_id, is_long, margin_raw, leverage, position_id, deadline
    ) values (
      ${trade.intentId}, ${trade.wallet}, ${trade.kind}, ${trade.instrumentId}, ${trade.isLong},
      ${trade.marginRaw.toString()}, ${trade.leverage}, ${trade.positionId ?? null}, ${trade.deadline}
    )
    on conflict (intent_id) do nothing
  `;
}

/**
 * Settles the wallet's submitted trades against its current account: an open is
 * filled once a position carries its intent ID, a close once the position is gone.
 * Either is not_filled once its deadline passes without that, and it's no longer
 * queued.
 */
export async function settleTrades(wallet: string, account: Account) {
  const pending = await sql<{ intentId: string; kind: TradeKind; positionId: string | null; deadline: Date }[]>`
    select intent_id as "intentId", kind, position_id::text as "positionId", deadline
    from trades
    where wallet_address = ${wallet} and status = 'submitted'
  `;
  const now = Date.now();
  for (const trade of pending) {
    const queued = account.operations.some((op) => op.intentId === trade.intentId);
    if (trade.kind === "open") {
      const position = account.openPositions.find((p) => p.intentId === trade.intentId);
      if (position) {
        await sql`
          update trades
          set status = 'filled', position_id = ${position.positionId},
            entry_price_raw = ${position.entryPriceRaw}, settled_at = now()
          where intent_id = ${trade.intentId}
        `;
        continue;
      }
    } else if (!queued && !account.openPositions.some((p) => p.positionId === trade.positionId)) {
      await sql`update trades set status = 'filled', settled_at = now() where intent_id = ${trade.intentId}`;
      continue;
    }
    if (!queued && trade.deadline.getTime() < now) {
      await sql`update trades set status = 'not_filled', settled_at = now() where intent_id = ${trade.intentId}`;
    }
  }
}

export async function recentTrades(limit = 25) {
  const rows = await sql<(Omit<Trade, "marginRaw" | "entryPriceRaw"> & { marginRaw: string; entryPriceRaw: string | null })[]>`
    select
      intent_id as "intentId",
      wallet_address as "wallet",
      kind,
      instrument_id as "instrumentId",
      is_long as "isLong",
      margin_raw::text as "marginRaw",
      leverage,
      position_id::text as "positionId",
      entry_price_raw::text as "entryPriceRaw",
      status,
      created_at as "createdAt"
    from trades
    order by created_at desc
    limit ${limit}
  `;
  return rows.map(
    (row): Trade => ({
      ...row,
      marginRaw: BigInt(row.marginRaw),
      entryPriceRaw: row.entryPriceRaw === null ? null : Number(row.entryPriceRaw),
    }),
  );
}
