import "server-only";

import { sql } from "./db";
import { readAccount, type Position } from "./papertrade/account";
import {
  CLOSE_DEADLINE_SEC,
  OPEN_DEADLINE_SEC,
  orderSigner,
  placeClose,
  placeOpen,
} from "./orders";

// Copies go out in parallel so they fill close to the trader's price, but capped
// so a popular trader doesn't flood papertrade's relayer from one server.
const COPY_CONCURRENCY = 8;

export async function isListedTrader(wallet: string) {
  const [row] = await sql`select 1 from traders where wallet_address = ${wallet}`;
  return Boolean(row);
}

/**
 * Places the same open for everyone copying `trader` whose session stays active
 * past the order's deadline. Copies don't trigger further copies.
 */
// TODO: size copies per copier (e.g. a fixed amount or a share of their balance)
// instead of reusing the trader's margin, so copiers with less balance aren't rejected.
export async function copyOpen(
  trader: string,
  leaderIntentId: string,
  order: { instrumentId: number; isLong: boolean; size: bigint; leverage: number },
) {
  const copiers = await sql<{ wallet: string; encryptedSessionKey: string }[]>`
    select ws.wallet_address as "wallet", ws.encrypted_session_key as "encryptedSessionKey"
    from copy_subscriptions cs
    join wallet_sessions ws on ws.wallet_address = cs.copier_wallet
    where cs.trader_wallet = ${trader}
      and ws.expires_at > now() + make_interval(secs => ${OPEN_DEADLINE_SEC})
  `;
  await forEachLimited(copiers, async (copier) => {
    const signer = orderSigner(copier.wallet, copier.encryptedSessionKey);
    if (!signer) return console.error("couldn't unlock session key to copy", copier.wallet);
    await placeOpen(signer, order, leaderIntentId);
  });
}

/**
 * Closes every open copy of the trader's position that `leaderOpenIntentId`
 * opened. A copier who already closed theirs, or whose copy never filled, is
 * skipped.
 */
export async function copyClose(leaderOpenIntentId: string, leaderCloseIntentId: string) {
  const copies = await sql<{ wallet: string; intentId: string; encryptedSessionKey: string }[]>`
    select t.wallet_address as "wallet", t.intent_id as "intentId",
      ws.encrypted_session_key as "encryptedSessionKey"
    from trades t
    join wallet_sessions ws on ws.wallet_address = t.wallet_address
    where t.copied_from_intent_id = ${leaderOpenIntentId}
      and t.kind = 'open'
      and t.status in ('submitted', 'filled')
      and ws.expires_at > now() + make_interval(secs => ${CLOSE_DEADLINE_SEC})
  `;
  await forEachLimited(copies, async (copy) => {
    const signer = orderSigner(copy.wallet, copy.encryptedSessionKey);
    if (!signer) return console.error("couldn't unlock session key to copy", copy.wallet);
    // A position carries the intent that opened it, so this finds the copy even
    // before its trade row has settled.
    const account = await readAccount(copy.wallet).catch(() => null);
    const position: Position | undefined = account?.openPositions.find((p) => p.intentId === copy.intentId);
    if (!position) return;
    await placeClose(signer, position, leaderCloseIntentId);
  });
}

async function forEachLimited<T>(items: T[], run: (item: T) => Promise<unknown>) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      await run(item).catch((error) => console.error("copy failed", error));
    }
  }
  await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, items.length) }, worker));
}
