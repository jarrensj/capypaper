"use server";

import { refresh } from "next/cache";
import { isAddress } from "viem";
import { setCopying } from "@/lib/copying";
import { currentSession } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string };

export async function toggleCopying(trader: string, enabled: boolean): Promise<Result> {
  const session = await currentSession();
  if (!session) return { ok: false, error: "Connect your wallet first." };
  if (!isAddress(trader)) return { ok: false, error: "That trader doesn't exist." };
  const wallet = trader.toLowerCase();
  if (wallet === session.wallet) return { ok: false, error: "You can't copy yourself." };

  if (!(await setCopying(session.wallet, wallet, enabled))) {
    return { ok: false, error: "That trader isn't on the list anymore." };
  }
  refresh();
  return { ok: true };
}
