import "server-only";

import { sql } from "./db";
import type { Account } from "./papertrade/account";
import type { TradeKind } from "./trades";

export type LimitOrderStatus = "pending" | "triggered" | "placed" | "failed" | "cancelled";

export type LimitOrder = {
  id: string;
  kind: TradeKind;
  instrumentId: number;
  isLong: boolean;
  marginRaw: bigint;
  leverage: number;
  positionId: string | null;
  limitPriceRaw: number;
  status: LimitOrderStatus;
  error: string | null;
  createdAt: Date;
};

type NewLimitOrder = Pick<LimitOrder, "kind" | "instrumentId" | "isLong" | "marginRaw" | "leverage" | "limitPriceRaw"> & {
  /** Required for closes: the position to close. */
  positionId?: string;
};

const MAX_PENDING = 20;

const COLUMNS = sql`
  id,
  kind,
  instrument_id as "instrumentId",
  is_long as "isLong",
  margin_raw::text as "marginRaw",
  leverage,
  position_id::text as "positionId",
  limit_price_raw::text as "limitPriceRaw",
  status,
  error,
  created_at as "createdAt"
`;

type Row = Omit<LimitOrder, "marginRaw" | "limitPriceRaw"> & { marginRaw: string; limitPriceRaw: string };

function fromRow(row: Row): LimitOrder {
  return { ...row, marginRaw: BigInt(row.marginRaw), limitPriceRaw: Number(row.limitPriceRaw) };
}

/**
 * Saves a limit order for the wallet. A limit close replaces any pending one for
 * the same position. Returns false if the wallet already has MAX_PENDING pending.
 */
// TODO: once capypaper has Terms of Service, say there that capypaper places limit
// orders for traders when the price reaches their limit, only while capypaper is open.
export async function createLimitOrder(wallet: string, order: NewLimitOrder) {
  return sql.begin(async (tx) => {
    if (order.kind === "close") {
      await tx`
        update limit_orders set status = 'cancelled', error = 'Replaced by a newer limit close.', updated_at = now()
        where wallet_address = ${wallet} and kind = 'close' and status = 'pending'
          and position_id = ${order.positionId ?? null}
      `;
    }
    const [{ pending }] = await tx<{ pending: number }[]>`
      select count(*)::int as pending from limit_orders
      where wallet_address = ${wallet} and status = 'pending'
    `;
    if (pending >= MAX_PENDING) return false;
    await tx`
      insert into limit_orders (
        wallet_address, kind, instrument_id, is_long, margin_raw, leverage, position_id, limit_price_raw
      ) values (
        ${wallet}, ${order.kind}, ${order.instrumentId}, ${order.isLong}, ${order.marginRaw.toString()},
        ${order.leverage}, ${order.positionId ?? null}, ${order.limitPriceRaw}
      )
    `;
    return true;
  });
}

/** The wallet's most recent limit orders, newest first. */
export async function listLimitOrders(wallet: string, limit = 10) {
  const rows = await sql<Row[]>`
    select ${COLUMNS} from limit_orders
    where wallet_address = ${wallet}
    order by created_at desc
    limit ${limit}
  `;
  return rows.map(fromRow);
}

export async function pendingLimitOrders(wallet: string) {
  const rows = await sql<Row[]>`
    select ${COLUMNS} from limit_orders
    where wallet_address = ${wallet} and status = 'pending'
    order by created_at
  `;
  return rows.map(fromRow);
}

/** Marks a pending order as triggered. False if another tab or request got to it first. */
export async function claimLimitOrder(id: string) {
  const rows = await sql`
    update limit_orders set status = 'triggered', updated_at = now()
    where id = ${id} and status = 'pending'
    returning id
  `;
  return rows.length > 0;
}

/** Records what happened when a triggered order was placed. */
export async function finishLimitOrder(id: string, placed: { ok: true; intentId: string } | { ok: false; error: string }) {
  await sql`
    update limit_orders
    set status = ${placed.ok ? "placed" : "failed"}, intent_id = ${placed.ok ? placed.intentId : null},
      error = ${placed.ok ? null : placed.error}, updated_at = now()
    where id = ${id} and status = 'triggered'
  `;
}

export async function cancelLimitOrder(wallet: string, id: string) {
  await sql`
    update limit_orders set status = 'cancelled', updated_at = now()
    where id = ${id} and wallet_address = ${wallet} and status = 'pending'
  `;
}

/** Cancels pending limit closes whose position the account no longer has open. */
export async function cancelClosesForClosedPositions(wallet: string, account: Account) {
  const closes = await sql<{ id: string; positionId: string }[]>`
    select id, position_id::text as "positionId" from limit_orders
    where wallet_address = ${wallet} and kind = 'close' and status = 'pending'
  `;
  const open = new Set(account.openPositions.map((p) => p.positionId));
  for (const close of closes) {
    if (open.has(close.positionId)) continue;
    await sql`
      update limit_orders set status = 'cancelled', error = 'The position closed.', updated_at = now()
      where id = ${close.id} and status = 'pending'
    `;
  }
}
