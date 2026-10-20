/**
 * Papertrade's markets. Positions fill at the HyperCore best bid/offer mid, which
 * papertrade reads onchain as integers in units of 1 / priceScale.
 */
export const MARKETS = [
  { coin: "BTC", instrumentId: 0, priceScale: 10 },
  { coin: "ETH", instrumentId: 1, priceScale: 100 },
] as const;

export type Coin = (typeof MARKETS)[number]["coin"];
