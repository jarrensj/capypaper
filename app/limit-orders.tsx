"use client";

import { useEffect, useRef } from "react";
import { limitReached } from "@/lib/limit-price";
import { MARKETS, type Coin } from "@/lib/papertrade/markets";
import { fireLimitOrders } from "./limit-order-actions";
import { STALE_AFTER_MS, useBbo } from "./prices";

export type LimitOrderView = {
  id: string;
  kind: "open" | "close";
  coin: Coin;
  isLong: boolean;
  /** In units of 1 / the market's priceScale. */
  limitPriceRaw: number;
  limit: string;
  size: string;
  status: "pending" | "triggered" | "placed" | "failed" | "cancelled";
  error: string | null;
};

// Wait this long after asking the server to fire, so a limit the server's price
// hasn't reached yet doesn't send a request on every tick.
const RETRY_FIRE_MS = 2000;

export function LimitOrders({
  orders,
  disabled,
  onCancel,
}: {
  orders: LimitOrderView[];
  disabled: boolean;
  onCancel: (id: string) => void;
}) {
  const pending = orders.filter((o) => o.status === "pending");
  return (
    <div className="flex w-full flex-col items-center gap-2">
      {pending.length > 0 && <LimitOrderWatcher orders={pending} />}
      <h2>Limit orders</h2>
      <p className="text-sm">
        A limit close sells a long once the price is at or above your limit, and buys back a
        short once it&apos;s at or below. Limit orders only fire while capypaper is open in one
        of your tabs. They fill at papertrade&apos;s price when they fire, which can be past
        your limit.
      </p>
      {orders.length === 0 ? (
        <p className="text-sm">No limit orders.</p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full text-sm" aria-label="Limit orders">
            <thead>
              <tr className="text-left">
                <th className="p-1">Order</th>
                <th className="p-1">Size</th>
                <th className="p-1">Limit</th>
                <th className="p-1">Status</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} data-limit-order-id={o.id}>
                  <td className="p-1">
                    {o.kind === "open" ? "Open" : "Close"} {o.coin} {o.isLong ? "long" : "short"}
                  </td>
                  <td className="p-1">{o.size}</td>
                  <td className="p-1">{o.limit}</td>
                  <td className="p-1">{statusText(o)}</td>
                  <td className="p-1">
                    {o.status === "pending" && (
                      <button className="rounded border px-2" disabled={disabled} onClick={() => onCancel(o.id)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Watches HyperCore's live prices and asks the server to fire pending orders once
 * one's limit looks reached. The server checks the price again before placing anything.
 */
// TODO: watch prices in a dedicated worker instead, so limit orders fire while
// capypaper isn't open.
function LimitOrderWatcher({ orders }: { orders: LimitOrderView[] }) {
  const { quotes, now } = useBbo();
  const firing = useRef(false);
  const lastFiredAt = useRef(0);

  useEffect(() => {
    const reached = orders.some((order) => {
      const quote = quotes[order.coin];
      const market = MARKETS.find((m) => m.coin === order.coin);
      if (!quote || !market || (now !== null && now - quote.receivedAt > STALE_AFTER_MS)) return false;
      return limitReached(order, Math.round(quote.mid * market.priceScale));
    });
    if (!reached || firing.current || Date.now() - lastFiredAt.current < RETRY_FIRE_MS) return;

    firing.current = true;
    fireLimitOrders()
      .catch((error) => console.error("couldn't fire limit orders", error))
      .finally(() => {
        firing.current = false;
        lastFiredAt.current = Date.now();
      });
  }, [orders, quotes, now]);
  return null;
}

function statusText(order: LimitOrderView) {
  switch (order.status) {
    case "pending":
      return "Waiting";
    case "triggered":
      return "Placing…";
    case "placed":
      return "Placed";
    case "failed":
      return `Failed: ${order.error ?? "unknown error"}`;
    case "cancelled":
      return order.error ? `Cancelled: ${order.error}` : "Cancelled";
  }
}
