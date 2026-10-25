"use client";

import { useState, useTransition } from "react";
import { shortAddress } from "@/lib/format";
import { HYPEREVM } from "@/lib/papertrade/config";
import {
  completeConnect,
  confirmRegistration,
  disconnect,
  prepareConnect,
} from "./actions";

export type SessionView = {
  wallet: string;
  status: "active" | "renew-soon" | "expired" | "pending";
  /** e.g. "Nov 19, 2026, 09:27 UTC" */
  expiresLabel: string | null;
  /** True when papertrade couldn't be reached and this is the last known state. */
  stale: boolean;
};

type Ethereum = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

const CONFIRM_POLL_MS = 2000;
const CONFIRM_TIMEOUT_MS = 90_000;

export function WalletSession({ session }: { session: SessionView | null }) {
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function connect() {
    setError(null);
    startTransition(async () => {
      try {
        await registerSessionKey(setStep);
      } catch (err) {
        setError(walletErrorMessage(err));
      } finally {
        setStep(null);
      }
    });
  }

  function signOut() {
    setError(null);
    startTransition(() => disconnect());
  }

  return (
    <section className="flex max-w-md flex-col items-center gap-3 text-center">
      {session ? (
        <>
          <p>
            Connected as <code>{shortAddress(session.wallet)}</code>
          </p>
          <p>{statusText(session)}</p>
          <div className="flex gap-3">
            <button className="rounded border px-4 py-2" onClick={connect} disabled={busy}>
              Renew session
            </button>
            <button className="rounded border px-4 py-2" onClick={signOut} disabled={busy}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <button className="rounded border px-4 py-2" onClick={connect} disabled={busy}>
            Connect wallet
          </button>
          <p className="text-sm">
            Connecting registers a capypaper session key with papertrade. For 30 days it can open
            and close positions for you, but it can&apos;t withdraw.
          </p>
        </>
      )}
      {step && <p role="status">{step}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

async function registerSessionKey(setStep: (step: string) => void) {
  const ethereum = (window as { ethereum?: Ethereum }).ethereum;
  if (!ethereum) {
    throw new Error("No wallet found. Install MetaMask or another browser wallet.");
  }

  setStep("Connecting your wallet…");
  const [address] = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
  if (!address) throw new Error("Your wallet didn't share an account.");
  // Wallets only sign typed data for the chain they're on, and papertrade's is HyperEVM.
  await switchToHyperEvm(ethereum);

  const prepared = await prepareConnect(address);
  if (!prepared.ok) throw new Error(prepared.error);

  setStep("Approve the session key in your wallet…");
  const signature = await ethereum.request({
    method: "eth_signTypedData_v4",
    params: [address, JSON.stringify(prepared.typedData)],
  });

  setStep("Registering with papertrade…");
  const completed = await completeConnect(prepared.pending, String(signature));
  if (!completed.ok) throw new Error(completed.error);

  setStep("Waiting for papertrade to confirm…");
  const giveUpAt = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < giveUpAt) {
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS));
    const confirmed = await confirmRegistration(completed.expiry);
    if (!confirmed.ok) throw new Error(confirmed.error);
    if (confirmed.confirmed) return;
  }
  throw new Error("Papertrade hasn't confirmed the session key yet. Refresh in a minute.");
}

async function switchToHyperEvm(ethereum: Ethereum) {
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HYPEREVM.chainId }],
    });
  } catch (err) {
    // 4902: the wallet doesn't know the chain yet.
    if ((err as { code?: number }).code !== 4902) throw err;
    await ethereum.request({ method: "wallet_addEthereumChain", params: [HYPEREVM] });
  }
}

function walletErrorMessage(err: unknown) {
  if ((err as { code?: number }).code === 4001) return "You cancelled the request in your wallet.";
  return err instanceof Error ? err.message : "Something went wrong. Try again.";
}

function statusText(session: SessionView) {
  const until = session.expiresLabel ? ` until ${session.expiresLabel}` : "";
  const text = {
    active: `Session active${until}.`,
    "renew-soon": `Session expires soon${until}. Renew to keep trading.`,
    expired: "Session expired. Renew to keep trading.",
    pending: "Waiting for papertrade to confirm your session key.",
  }[session.status];
  return session.stale ? `${text} (Couldn't reach papertrade, so this may be out of date.)` : text;
}
