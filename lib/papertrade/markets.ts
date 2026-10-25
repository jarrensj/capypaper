/**
 * Papertrade's markets. Positions fill at the HyperCore best bid/offer mid, which
 * papertrade reads onchain as integers in units of 1 / priceScale.
 */
export const MARKETS = [
  { coin: "BTC", instrumentId: 0, priceScale: 10 },
  { coin: "ETH", instrumentId: 1, priceScale: 100 },
] as const;

export type Coin = (typeof MARKETS)[number]["coin"];

/** Papertrade's mid for a best bid and offer, in units of 1 / priceScale: integer division of the scaled prices. */
export function midRaw(bid: number, ask: number, priceScale: number) {
  return Math.floor((Math.round(bid * priceScale) + Math.round(ask * priceScale)) / 2);
}
