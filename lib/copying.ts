import "server-only";

import { sql } from "./db";

export type Trader = {
  wallet: string;
  displayName: string;
  /** Whether the viewer is copying this trader. */
  copying: boolean;
};

export async function listTraders(viewer: string) {
  return sql<Trader[]>`
    select
      t.wallet_address as "wallet",
      t.display_name as "displayName",
      (s.copier_wallet is not null) as "copying"
    from traders t
    left join copy_subscriptions s
      on s.trader_wallet = t.wallet_address and s.copier_wallet = ${viewer}
    order by t.display_name
  `;
}

/** Turns copying `trader` on or off for `copier`. Returns false if `trader` isn't a listed trader. */
export async function setCopying(copier: string, trader: string, enabled: boolean) {
  if (!enabled) {
    await sql`delete from copy_subscriptions where copier_wallet = ${copier} and trader_wallet = ${trader}`;
    return true;
  }
  const inserted = await sql`
    insert into copy_subscriptions (copier_wallet, trader_wallet)
    select ${copier}, wallet_address from traders where wallet_address = ${trader}
    on conflict do nothing
    returning 1
  `;
  if (inserted.length) return true;
  const [listed] = await sql`select 1 from traders where wallet_address = ${trader}`;
  return Boolean(listed);
}
