import { Suspense } from "react";
import { formatPrice, formatUsd } from "@/lib/format";
import { readAccount, type Account } from "@/lib/papertrade/account";
import {
  SESSION_KEY_MIN_REMAINING_SEC,
  SESSION_KEY_RENEW_WITHIN_SEC,
} from "@/lib/papertrade/config";
import { MARKETS } from "@/lib/papertrade/markets";
import { currentSession } from "@/lib/session";
import { Trade, type TradeView } from "./trade";
import { WalletSession, type SessionView } from "./wallet-session";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1>capypaper</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Session />
      </Suspense>
    </main>
  );
}

async function Session() {
  const session = await currentSession();
  if (!session) return <WalletSession session={null} />;

  // Papertrade is the source of truth for the key's expiry; fall back to the last
  // confirmed one if it can't be reached.
  const account = await readAccount(session.wallet).catch(() => null);
  const expiry = account
    ? account.sessionKeys.get(session.sessionKeyAddress)
    : session.expiresAt && session.expiresAt.getTime() / 1000;

  const status = sessionStatus(expiry ?? null, session.expiresAt === null);
  const canTrade = account !== null && (status === "active" || status === "renew-soon");
  return (
    <>
      <WalletSession
        session={{
          wallet: session.wallet,
          status,
          expiresLabel: expiry ? formatUtc(expiry) : null,
          stale: account === null,
        }}
      />
      {canTrade && <Trade view={tradeView(account)} />}
    </>
  );
}

function tradeView(account: Account): TradeView {
  return {
    availableBalance: formatUsd(account.availableBalance),
    queued: account.operations.length,
    positions: account.openPositions.flatMap((p) => {
      const market = MARKETS.find((m) => m.instrumentId === p.instrumentId);
      if (!market) return [];
      return [
        {
          positionId: p.positionId,
          intentId: p.intentId,
          coin: market.coin,
          side: p.isLong ? "Long" : "Short",
          margin: formatUsd(p.marginRaw),
          leverage: p.leverage,
          entry: formatPrice(p.entryPriceRaw / market.priceScale, market.priceScale),
          liquidation: formatPrice(p.bustPriceRaw / market.priceScale, market.priceScale),
        },
      ];
    }),
  };
}

function sessionStatus(expiry: number | null, neverConfirmed: boolean): SessionView["status"] {
  if (expiry === null) return neverConfirmed ? "pending" : "expired";
  const remaining = expiry - Date.now() / 1000;
  if (remaining < SESSION_KEY_MIN_REMAINING_SEC) return "expired";
  if (remaining < SESSION_KEY_RENEW_WITHIN_SEC) return "renew-soon";
  return "active";
}

function formatUtc(unixSec: number) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(unixSec * 1000) + " UTC";
}
