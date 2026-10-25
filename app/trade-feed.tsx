import { formatPrice, formatUsd, shortAddress } from "@/lib/format";
import { MARKETS } from "@/lib/papertrade/markets";
import type { Trade } from "@/lib/trades";
import { AutoRefresh } from "./auto-refresh";

const FEED_REFRESH_MS = 10_000;

/** Recent trades placed through capypaper, for signed-in visitors. Null trades means they couldn't be loaded. */
// TODO: once capypaper has a Privacy Policy, say there that signed-in users see each
// other's trades with shortened wallet addresses.
export function TradeFeed({ trades, wallet }: { trades: Trade[] | null; wallet: string }) {
  return (
    <section className="flex w-full max-w-2xl flex-col items-center gap-2 px-4">
      <AutoRefresh everyMs={FEED_REFRESH_MS} />
      <h2>Recent trades on capypaper</h2>
      {trades === null ? (
        <p className="text-sm">Couldn&apos;t load recent trades.</p>
      ) : trades.length === 0 ? (
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
                      {trade.wallet === wallet ? (
                        "You"
                      ) : (
                        (trade.traderName ?? <code>{shortAddress(trade.wallet)}</code>)
                      )}
                    </td>
                    <td className="p-1">
                      {trade.kind === "open" ? "Opened" : "Closed"} {market?.coin ?? `#${trade.instrumentId}`}{" "}
                      {trade.isLong ? "long" : "short"}
                      {trade.copiedFromName && ` (copying ${trade.copiedFromName})`}
                    </td>
                    <td className="p-1">
                      {formatUsd(trade.marginRaw)} × {trade.leverage}
                    </td>
                    <td className="p-1">{statusText(trade, market?.priceScale, trade.wallet === wallet)}</td>
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

function statusText(trade: Trade, priceScale: number | undefined, own: boolean) {
  if (trade.status === "submitted") return "Pending";
  if (trade.status === "not_filled") return "Not filled";
  // The reason is written for the copier ("You don't have enough…"), so only they see it.
  if (trade.status === "rejected") return own && trade.error ? `Rejected: ${trade.error}` : "Rejected";
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
