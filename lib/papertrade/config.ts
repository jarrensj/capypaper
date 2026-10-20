export const PAPERTRADE_URL =
  process.env.PAPERTRADE_URL ?? "https://exchange.papertrade.xyz";

// Papertrade sits behind Cloudflare, which 404s requests with generic user agents.
export const USER_AGENT =
  "capypaper/0.1 (+https://github.com/jarrensj/capypaper)";

export const CHAIN_ID = 999; // HyperEVM mainnet
export const EXCHANGE = "0x6cd5661646289fb6e65ea5c032310fded797d0a2";

export const INTENT_TTL_SEC = 60 * 60; // every intent's deadline is now + 1h
export const SESSION_KEY_TTL_SEC = 30 * 24 * 60 * 60; // session keys last 30 days

// Papertrade's app treats a key with under an hour left as expired, since an
// intent signed by it could outlive it.
export const SESSION_KEY_MIN_REMAINING_SEC = INTENT_TTL_SEC;
// Ask for a renewal once a key has under 3 days left.
export const SESSION_KEY_RENEW_WITHIN_SEC = 3 * 24 * 60 * 60;

export const HYPEREVM = {
  chainId: `0x${CHAIN_ID.toString(16)}`,
  chainName: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: ["https://rpc.hyperliquid.xyz/evm"],
  blockExplorerUrls: ["https://hyperevmscan.io"],
};
