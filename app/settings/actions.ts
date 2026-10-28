"use server";

import { refresh } from "next/cache";
import { getAddress, isAddress, zeroAddress } from "viem";
import { currentSession } from "@/lib/session";
import { savePayoutAddress } from "@/lib/settings";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Sets where the signed-in wallet gets paid when people subscribe to copy its
 * trades. A blank address clears it.
 */
// TODO: before subscriptions pay out to this address, require a fresh wallet
// signature to change it, so a stolen session cookie can't redirect a trader's payouts.
export async function updatePayoutAddress(
  address: string,
): Promise<Result<{ payoutAddress: string | null }>> {
  const session = await currentSession();
  if (!session) return { ok: false, error: "Connect your wallet first." };

  const input = address.trim();
  if (input === "") {
    await savePayoutAddress(session.wallet, null);
    refresh();
    return { ok: true, payoutAddress: null };
  }
  if (!isAddress(input, { strict: false })) {
    return { ok: false, error: "Enter an EVM address: 0x followed by 40 characters, 0–9 and a–f." };
  }
  // Mixed-case addresses carry a checksum, so a mismatch means a typo.
  if (!isAddress(input)) {
    return { ok: false, error: "That address has a typo. Copy it again from your wallet." };
  }
  if (input.toLowerCase() === zeroAddress) {
    return { ok: false, error: "That's the zero address. Nobody can spend what's sent there." };
  }

  await savePayoutAddress(session.wallet, input.toLowerCase());
  refresh();
  return { ok: true, payoutAddress: getAddress(input) };
}
