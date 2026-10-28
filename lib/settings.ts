import "server-only";

import { sql } from "./db";

// TODO: once capypaper has a Privacy Policy, say there that it stores each wallet's
// payout address and will share it with the people who pay to copy that wallet.

/** Where the wallet gets paid when people subscribe to copy its trades, or null if it hasn't set one. */
// TODO: send copy subscription payments here once subscriptions are built.
export async function findPayoutAddress(wallet: string) {
  const [row] = await sql<{ payoutAddress: string | null }[]>`
    select payout_address as "payoutAddress"
    from wallet_settings
    where wallet_address = ${wallet}
  `;
  return row?.payoutAddress ?? null;
}

/** Sets the wallet's payout address, or clears it when payoutAddress is null. */
export async function savePayoutAddress(wallet: string, payoutAddress: string | null) {
  await sql`
    insert into wallet_settings (wallet_address, payout_address)
    values (${wallet}, ${payoutAddress})
    on conflict (wallet_address) do update set
      payout_address = excluded.payout_address,
      updated_at = now()
  `;
}
