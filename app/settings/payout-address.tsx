"use client";

import { useState, useTransition } from "react";
import { updatePayoutAddress } from "./actions";

export function PayoutAddress({ saved }: { saved: string | null }) {
  const [address, setAddress] = useState(saved ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function save() {
    setStatus(null);
    setError(null);
    startTransition(async () => {
      const result = await updatePayoutAddress(address);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAddress(result.payoutAddress ?? "");
      setStatus(result.payoutAddress ? "Payout address saved." : "Payout address removed.");
    });
  }

  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label htmlFor="payout-address" className="font-medium">
        Payout address
      </label>
      <p id="payout-address-help" className="text-sm">
        This is where you get paid when people subscribe to copy your trades. Use an EVM wallet
        you control, since payments sent to it can&apos;t be reversed.
      </p>
      <div className="flex gap-2">
        <input
          id="payout-address"
          className="min-w-0 flex-1 rounded border px-2 py-1 font-mono text-sm"
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="payout-address-help"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setStatus(null);
          }}
        />
        <button className="rounded border px-4 py-1" disabled={busy || address.trim() === (saved ?? "")}>
          Save
        </button>
      </div>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
