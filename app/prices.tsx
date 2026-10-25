"use client";

import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/format";
import { MARKETS, midRaw, type Coin } from "@/lib/papertrade/markets";

// Papertrade prices against HyperCore's book, so stream its best bid/offer.
const HL_WS_URL = "wss://api.hyperliquid.xyz/ws";
export const STALE_AFTER_MS = 10_000;
// Close a socket that's open but silent, and reconnect.
const SILENT_SOCKET_MS = 3 * STALE_AFTER_MS;
const PING_EVERY_MS = 30_000;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

type Quote = { bid: number; ask: number; mid: number; receivedAt: number };

export function Prices() {
  const { quotes, now } = useBbo();
  return (
    <header className="fixed inset-x-0 top-0 flex justify-center gap-6 p-4 font-mono text-sm">
      {MARKETS.map(({ coin, priceScale }) => {
        const quote = quotes[coin];
        // `now` is null until the first tick; a quote that arrives before it is fresh.
        const stale = !quote || (now !== null && now - quote.receivedAt > STALE_AFTER_MS);
        return (
          <span
            key={coin}
            data-coin={coin}
            data-stale={stale}
            className={stale ? "opacity-50" : undefined}
            title={
              quote
                ? `Bid ${formatPrice(quote.bid, priceScale)} / ask ${formatPrice(quote.ask, priceScale)}`
                : undefined
            }
          >
            {coin} {quote ? formatPrice(quote.mid, priceScale) : "—"}
            {quote && stale ? " (stale)" : null}
          </span>
        );
      })}
    </header>
  );
}

/** Live HyperCore best bid/offer per coin, reconnecting with backoff when the socket drops. */
export function useBbo() {
  const [quotes, setQuotes] = useState<Partial<Record<Coin, Quote>>>({});
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let disposed = false;
    let retryMs = MIN_RETRY_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let lastMessageAt = 0;
    let lastPingAt = 0;

    function connect() {
      const socket = (ws = new WebSocket(HL_WS_URL));
      socket.onopen = () => {
        lastMessageAt = lastPingAt = Date.now();
        for (const { coin } of MARKETS) {
          socket.send(JSON.stringify({ method: "subscribe", subscription: { type: "bbo", coin } }));
        }
      };
      socket.onmessage = (event) => {
        lastMessageAt = Date.now();
        const quote = parseBbo(String(event.data));
        if (!quote) return;
        retryMs = MIN_RETRY_MS;
        setQuotes((current) => ({ ...current, [quote.coin]: { ...quote, receivedAt: lastMessageAt } }));
      };
      socket.onclose = () => {
        if (disposed || socket !== ws) return;
        // Jitter so clients don't all reconnect at once after an outage.
        retryTimer = setTimeout(connect, retryMs / 2 + Math.random() * (retryMs / 2));
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
      };
    }

    const tick = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (ws?.readyState !== WebSocket.OPEN) return;
      if (t - lastMessageAt > SILENT_SOCKET_MS) ws.close();
      else if (t - lastPingAt > PING_EVERY_MS) {
        ws.send(JSON.stringify({ method: "ping" }));
        lastPingAt = t;
      }
    }, 1000);

    connect();
    return () => {
      disposed = true;
      clearInterval(tick);
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  return { quotes, now };
}

function parseBbo(raw: string) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (message?.channel !== "bbo") return null;
  const market = MARKETS.find(({ coin }) => coin === message.data?.coin);
  if (!market) return null;

  const bid = Number(message.data.bbo?.[0]?.px);
  const ask = Number(message.data.bbo?.[1]?.px);
  // Skip quotes papertrade's oracle wouldn't price at: a missing side, a
  // non-positive price, or a crossed book.
  if (!(bid > 0) || !(ask > 0) || ask < bid) return null;

  return { coin: market.coin, bid, ask, mid: midRaw(bid, ask, market.priceScale) / market.priceScale };
}
