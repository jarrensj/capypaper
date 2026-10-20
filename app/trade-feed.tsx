import { formatPrice, formatUsd, shortAddress } from "@/lib/format";
import { MARKETS } from "@/lib/papertrade/markets";
import type { Trade } from "@/lib/trades";
import { AutoRefresh } from "./auto-refresh";

const FEED_REFRESH_MS = 10_000;

/** Recent trades placed through capypaper, for signed-in visitors. */
export function TradeFeed({ trades, wallet }: { trades: Trade[]; wallet: string }) {
  return (
    <section className="flex w-full max-w-2xl flex-col items-center gap-2 px-4">
      <AutoRefresh everyMs={FEED_REFRESH_MS} />
      <h2>Recent trades on capypaper</h2>
      {trades.length === 0 ? (
        <p className="text-sm">No trades yet.</p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full text-sm" aria-label="Recent trades">
            <thead>
              <tr className="text-left">
                <th className="p-1">Time</th>
                <th className="p-1">Trader</th>
                <th className="p-1">Order</th>
                <th className="p-1">Size</th>
                <th className="p-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => {
                const market = MARKETS.find((m) => m.instrumentId === trade.instrumentId);
                return (
                  <tr key={trade.intentId} data-intent-id={trade.intentId}>
                    <td className="p-1">{formatTime(trade.createdAt)}</td>
                    <td className="p-1">
                      {trade.wallet === wallet ? "You" : <code>{shortAddress(trade.wallet)}</code>}
                    </td>
                    <td className="p-1">
                      {trade.kind === "open" ? "Opened" : "Closed"} {market?.coin ?? `#${trade.instrumentId}`}{" "}
                      {trade.isLong ? "long" : "short"}
                    </td>
                    <td className="p-1">
                      {formatUsd(trade.marginRaw)} × {trade.leverage}
                    </td>
                    <td className="p-1">{statusText(trade, market?.priceScale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function statusText(trade: Trade, priceScale: number | undefined) {
  if (trade.status === "submitted") return "Pending";
  if (trade.status === "not_filled") return "Not filled";
  if (trade.kind === "close") return "Filled";
  return trade.entryPriceRaw !== null && priceScale
    ? `Filled at ${formatPrice(trade.entryPriceRaw / priceScale, priceScale)}`
    : "Filled";
}

function formatTime(date: Date) {
  return (
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(date) + " UTC"
  );
}
