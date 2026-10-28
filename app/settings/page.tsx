import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getAddress } from "viem";
import { currentSession } from "@/lib/session";
import { findPayoutAddress } from "@/lib/settings";
import { PayoutAddress } from "./payout-address";

export const metadata: Metadata = {
  title: "Settings · capypaper",
};

export default function Settings() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1>Settings</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <WalletSettings />
      </Suspense>
      <Link className="text-sm underline" href="/">
        Back to capypaper
      </Link>
    </main>
  );
}

async function WalletSettings() {
  const session = await currentSession();
  if (!session) return <p>Connect your wallet on the home page to change your settings.</p>;

  const payoutAddress = await findPayoutAddress(session.wallet);
  return (
    <section className="flex w-full max-w-md flex-col gap-6">
      <PayoutAddress saved={payoutAddress && getAddress(payoutAddress)} />
    </section>
  );
}
