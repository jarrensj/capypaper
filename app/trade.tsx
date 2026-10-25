"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { MARKETS } from "@/lib/papertrade/markets";
import { cancelLimitOrder, placeLimitClose, placeLimitOpen } from "./limit-order-actions";
import { LimitOrders, type LimitOrderView } from "./limit-orders";
import { closePosition, openPosition } from "./trade-actions";

export type PositionView = {
  positionId: string;
  intentId: string;
  coin: string;
  side: "Long" | "Short";
  margin: string;
  leverage: number;
  entry: string;
  liquidation: string;
};

export type TradeView = {
  availableBalance: string;
  positions: PositionView[];
  /** How many of the wallet's intents papertrade has queued but not settled. */
  queued: number;
  /** Null if they couldn't be loaded. */
  limitOrders: LimitOrderView[] | null;
};

type Awaiting =
  | { kind: "open"; intentId: string | null; knownPositionIds: string[] }
  | { kind: "close"; positionIds: string[] };

const REFRESH_EVERY_MS = 2000;
// Longer than an open's 60s deadline, so a missing fill means it didn't go through.
const SETTLE_TIMEOUT_MS = 75_000;

export function Trade({ view }: { view: TradeView }) {
  const router = useRouter();
  const [coin, setCoin] = useState<string>(MARKETS[0].coin);
  const [margin, setMargin] = useState("10");
  const [leverage, setLeverage] = useState("100");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  // Limit close prices being typed, by position ID.
  const [closeLimits, setCloseLimits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [busy, startTransition] = useTransition();
  const [savingLimit, startLimitTransition] = useTransition();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const settled = awaiting !== null && isSettled(awaiting, view.positions);
  const waiting = awaiting !== null && !settled && !timedOut;

  // Re-read the account until papertrade settles the order.
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => router.refresh(), REFRESH_EVERY_MS);
    return () => clearTimeout(timer);
  }, [waiting, view, router]);

  function submit(next: () => Promise<{ ok: true; awaiting: Awaiting } | { ok: false; error: string }>) {
    setError(null);
    setAwaiting(null);
    setTimedOut(false);
    clearTimeout(timeoutRef.current);
    startTransition(async () => {
      const result = await next();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAwaiting(result.awaiting);
      timeoutRef.current = setTimeout(() => setTimedOut(true), SETTLE_TIMEOUT_MS);
    });
  }

  /** Runs a limit-order action, which needs no fill to wait for. */
  function submitLimit(next: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startLimitTransition(async () => {
      const result = await next();
      if (!result.ok) setError(result.error);
    });
  }

  function open(isLong: boolean) {
    if (orderType === "limit") {
      submitLimit(() => placeLimitOpen({ coin, isLong, margin, leverage: Number(leverage), limitPrice }));
      return;
    }
    const knownPositionIds = view.positions.map((p) => p.positionId);
    submit(async () => {
      const result = await openPosition({ coin, isLong, margin, leverage: Number(leverage) });
      return result.ok
        ? { ok: true, awaiting: { kind: "open", intentId: result.intentId, knownPositionIds } }
        : result;
    });
  }

  function close(positionId: string) {
    submit(async () => {
      const result = await closePosition(positionId);
      return result.ok ? { ok: true, awaiting: { kind: "close", positionIds: [positionId] } } : result;
    });
  }

  return (
    <section className="flex w-full max-w-2xl flex-col items-center gap-4 px-4">
      <p>Available balance: {view.availableBalance}</p>

      <form className="flex flex-wrap items-end justify-center gap-3" onSubmit={(e) => e.preventDefault()}>
        <label className="flex flex-col text-left text-sm">
          Market
          <select className="rounded border px-2 py-1" value={coin} onChange={(e) => setCoin(e.target.value)}>
            {MARKETS.map((m) => (
              <option key={m.coin}>{m.coin}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-left text-sm">
          Margin (USD)
          <input
            className="w-24 rounded border px-2 py-1"
            inputMode="decimal"
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-left text-sm">
          Order
          <select
            className="rounded border px-2 py-1"
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as "market" | "limit")}
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
          </select>
        </label>
        {orderType === "limit" && (
          <label className="flex flex-col text-left text-sm">
            Limit price
            <input
              className="w-28 rounded border px-2 py-1"
              inputMode="decimal"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
            />
          </label>
        )}
        <label className="flex flex-col text-left text-sm">
          Leverage
          <input
            className="w-20 rounded border px-2 py-1"
            inputMode="numeric"
            value={leverage}
            onChange={(e) => setLeverage(e.target.value)}
          />
        </label>
        <button type="button" className="rounded border px-4 py-1" disabled={busy || savingLimit || waiting} onClick={() => open(true)}>
          Long
        </button>
        <button type="button" className="rounded border px-4 py-1" disabled={busy || savingLimit || waiting} onClick={() => open(false)}>
          Short
        </button>
      </form>
      <p className="text-sm">
        Papertrade&apos;s minimums: $10 margin and a $1,000 position (margin × leverage).
        {orderType === "limit" &&
          " A limit long opens once the price is at or below your limit, a limit short once it's at or above."}
      </p>

      {busy && <p role="status">Sending your order to papertrade…</p>}
      {savingLimit && <p role="status">Updating your limit orders…</p>}
      {waiting && <p role="status">Waiting for papertrade to fill your order…</p>}
      {settled && <p role="status">{awaiting.kind === "open" ? "Position opened." : "Position closed."}</p>}
      {timedOut && !settled && (
        <p role="alert">Papertrade hasn&apos;t filled your order. It may have been rejected onchain.</p>
      )}
      {error && <p role="alert">{error}</p>}

      {view.queued > 0 && (
        <p className="text-sm">
          {view.queued} order{view.queued === 1 ? "" : "s"} queued on papertrade.
        </p>
      )}

      {view.positions.length === 0 ? (
        <p>No open positions.</p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full text-sm" aria-label="Open positions">
            <thead>
              <tr className="text-left">
                <th className="p-1">Market</th>
                <th className="p-1">Side</th>
                <th className="p-1">Margin</th>
                <th className="p-1">Leverage</th>
                <th className="p-1">Entry</th>
                <th className="p-1">Liquidation</th>
                <th className="p-1" />
                <th className="p-1">Limit close</th>
              </tr>
            </thead>
            <tbody>
              {view.positions.map((p) => (
                <tr key={p.positionId} data-position-id={p.positionId}>
                  <td className="p-1">{p.coin}</td>
                  <td className="p-1">{p.side}</td>
                  <td className="p-1">{p.margin}</td>
                  <td className="p-1">{p.leverage}×</td>
                  <td className="p-1">{p.entry}</td>
                  <td className="p-1">{p.liquidation}</td>
                  <td className="p-1">
                    <button
                      className="rounded border px-2"
                      disabled={busy || savingLimit || waiting}
                      onClick={() => close(p.positionId)}
                    >
                      Close
                    </button>
                  </td>
                  <td className="p-1">
                    <div className="flex gap-1">
                      <input
                        className="w-24 rounded border px-2"
                        inputMode="decimal"
                        aria-label={`Limit close price for ${p.coin} ${p.side.toLowerCase()}`}
                        value={closeLimits[p.positionId] ?? ""}
                        onChange={(e) => setCloseLimits((current) => ({ ...current, [p.positionId]: e.target.value }))}
                      />
                      <button
                        className="rounded border px-2"
                        disabled={busy || savingLimit}
                        onClick={() => submitLimit(() => placeLimitClose(p.positionId, closeLimits[p.positionId] ?? ""))}
                      >
                        Set
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view.limitOrders === null ? (
        <p className="text-sm">Couldn&apos;t load your limit orders.</p>
      ) : (
        <LimitOrders
          orders={view.limitOrders}
          disabled={busy || savingLimit}
          onCancel={(id) =>
            submitLimit(async () => {
              await cancelLimitOrder(id);
              return { ok: true };
            })
          }
        />
      )}
    </section>
  );
}

function isSettled(awaiting: Awaiting, positions: PositionView[]) {
  if (awaiting.kind === "close") {
    return awaiting.positionIds.every((id) => !positions.some((p) => p.positionId === id));
  }
  // Without an intent ID from the relayer, any new position is the one we opened.
  return positions.some((p) =>
    awaiting.intentId ? p.intentId === awaiting.intentId : !awaiting.knownPositionIds.includes(p.positionId),
  );
}
