"use client";

import { useState, useTransition } from "react";
import { shortAddress } from "@/lib/format";
import { toggleCopying } from "./copy-actions";

export type TraderView = { wallet: string; displayName: string; copying: boolean };

/** Listed traders, each with a toggle to copy their trades. */
export function Traders({ traders, viewer }: { traders: TraderView[]; viewer: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pendingWallet, setPendingWallet] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(trader: TraderView) {
    setError(null);
    setPendingWallet(trader.wallet);
    startTransition(async () => {
      const result = await toggleCopying(trader.wallet, !trader.copying);
      if (!result.ok) setError(result.error);
      setPendingWallet(null);
    });
  }

  return (
    <section className="flex w-full max-w-2xl flex-col items-center gap-2 px-4">
      <h2>Traders</h2>
      {traders.length === 0 ? (
        <p className="text-sm">No traders listed yet.</p>
      ) : (
        <ul className="flex w-full flex-col gap-2" aria-label="Traders">
          {traders.map((trader) => (
            <li key={trader.wallet} className="flex items-center justify-between gap-3" data-trader={trader.wallet}>
              <span>
                {trader.displayName} <code className="text-sm">{shortAddress(trader.wallet)}</code>
              </span>
              {trader.wallet === viewer ? (
                <span className="text-sm">You</span>
              ) : (
                <button
                  className="rounded border px-3 py-1 text-sm"
                  aria-pressed={trader.copying}
                  aria-label={`Copy ${trader.displayName}`}
                  disabled={pendingWallet === trader.wallet}
                  onClick={() => toggle(trader)}
                >
                  {trader.copying ? "Copying" : "Copy"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        While copying is on and your session is active, capypaper opens and closes the same positions for you,
        with the same margin and leverage, when the trader does.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
