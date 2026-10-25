import "server-only";

import { parseSignature, type Hex, type LocalAccount } from "viem";
import { CHAIN_ID, EXCHANGE } from "./config";

// "String" really is the domain name papertrade's contracts verify against.
export const DOMAIN = {
  name: "String",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: EXCHANGE,
} as const;

export const TYPES = {
  OpenPosition: [
    { name: "user", type: "address" },
    { name: "instrumentId", type: "uint32" },
    { name: "isLong", type: "bool" },
    // Margin in 18-decimal USD; notional is size × leverage.
    { name: "size", type: "uint128" },
    { name: "leverage", type: "uint32" },
    { name: "useDebt", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  Close: [
    { name: "user", type: "address" },
    { name: "positionIds", type: "uint256[]" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export type OpenPosition = {
  user: Hex;
  instrumentId: number;
  isLong: boolean;
  size: bigint;
  leverage: number;
  useDebt: boolean;
  nonce: bigint;
  deadline: bigint;
};

export type Close = {
  user: Hex;
  positionIds: bigint[];
  nonce: bigint;
  deadline: bigint;
};

/** Relayer wire format: uints as decimal strings, addresses lowercase, bools as bools. */
function serialize(value: unknown): unknown {
  if (typeof value === "bigint" || typeof value === "number") return value.toString();
  if (typeof value === "string") return value.toLowerCase();
  if (Array.isArray(value)) return value.map(serialize);
  return value;
}

/** Signs an intent with a session key and returns the `signed` body the relayer takes. */
export async function signIntent<T extends keyof typeof TYPES>(
  signer: LocalAccount,
  primaryType: T,
  message: T extends "OpenPosition" ? OpenPosition : Close,
) {
  const signature = await signer.signTypedData({
    domain: DOMAIN,
    types: { [primaryType]: TYPES[primaryType] } as Pick<typeof TYPES, T>,
    primaryType,
    message,
  } as Parameters<LocalAccount["signTypedData"]>[0]);
  const { r, s, yParity } = parseSignature(signature);
  return {
    ...Object.fromEntries(Object.entries(message).map(([k, v]) => [k, serialize(v)])),
    v: String(27 + (yParity ?? 0)),
    r: r.toLowerCase(),
    s: s.toLowerCase(),
  };
}
