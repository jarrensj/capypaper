import "server-only";

import { sql } from "./db";
import type { Account } from "./papertrade/account";

export type TradeKind = "open" | "close";
export type TradeStatus = "submitted" | "filled" | "not_filled" | "rejected";

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
  /** Why papertrade rejected it (only logged for copies). */
  error: string | null;
  /** The wallet's display name, if it's a listed trader. */
  traderName: string | null;
  /** For a copy, the display name of the trader it copies. */
  copiedFromName: string | null;
  createdAt: Date;
};

/** Logs an order papertrade's relayer accepted, or a copy it rejected (with `error`). */
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
  /** For a copy, the intent ID of the order it copies. */
  copiedFrom?: string;
  error?: string;
}) {
  await sql`
    insert into trades (
      intent_id, wallet_address, kind, instrument_id, is_long, margin_raw, leverage, position_id,
      deadline, copied_from_intent_id, status, error, settled_at
    ) values (
      ${trade.intentId}, ${trade.wallet}, ${trade.kind}, ${trade.instrumentId}, ${trade.isLong},
      ${trade.marginRaw.toString()}, ${trade.leverage}, ${trade.positionId ?? null}, ${trade.deadline},
      ${trade.copiedFrom ?? null}, ${trade.error ? "rejected" : "submitted"}, ${trade.error ?? null},
      ${trade.error ? new Date() : null}
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
      t.intent_id as "intentId",
      t.wallet_address as "wallet",
      t.kind,
      t.instrument_id as "instrumentId",
      t.is_long as "isLong",
      t.margin_raw::text as "marginRaw",
      t.leverage,
      t.position_id::text as "positionId",
      t.entry_price_raw::text as "entryPriceRaw",
      t.status,
      t.error,
      trader.display_name as "traderName",
      leader_trader.display_name as "copiedFromName",
      t.created_at as "createdAt"
    from trades t
    left join traders trader on trader.wallet_address = t.wallet_address
    left join trades leader on leader.intent_id = t.copied_from_intent_id
    left join traders leader_trader on leader_trader.wallet_address = leader.wallet_address
    order by t.created_at desc
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
