/**
 * Papertrade's markets. Positions fill at the HyperCore best bid/offer mid, which
 * papertrade reads onchain as integers in units of 1 / priceScale.
 */
export const MARKETS = [
  { coin: "BTC", priceScale: 10 },
  { coin: "ETH", priceScale: 100 },
] as const;

export type Coin = (typeof MARKETS)[number]["coin"];
