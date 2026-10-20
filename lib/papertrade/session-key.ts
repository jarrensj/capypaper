import "server-only";

import {
  parseSignature,
  verifyTypedData,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { INTENT_TTL_SEC, SESSION_KEY_TTL_SEC } from "./config";
import { DOMAIN } from "./intents";

const REGISTER_SESSION_KEY = [
  { name: "user", type: "address" },
  { name: "key", type: "address" },
  { name: "expiry", type: "uint64" },
  { name: "feeAddress", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint64" },
] as const;

/** RegisterSessionKey fields as the relayer expects them: uints as decimal strings, addresses lowercase. */
export type RegisterSessionKeyMessage = {
  user: string;
  key: string;
  expiry: string;
  feeAddress: string;
  nonce: string;
  deadline: string;
};

/** Papertrade's app starts each nonce counter at a random multiple of 256 (a fresh bitmap word). */
function randomNonce() {
  const [a, b, c] = crypto.getRandomValues(new Uint8Array(3));
  const word = (a << 16) | (b << 8) | c;
  return BigInt(word || 1) * BigInt(256);
}

export function registerSessionKeyMessage(
  wallet: Address,
  key: Address,
  nowSec = Math.floor(Date.now() / 1000),
): RegisterSessionKeyMessage {
  return {
    user: wallet.toLowerCase(),
    key: key.toLowerCase(),
    expiry: String(nowSec + SESSION_KEY_TTL_SEC),
    feeAddress: zeroAddress,
    nonce: randomNonce().toString(),
    deadline: String(nowSec + INTENT_TTL_SEC),
  };
}

/** The eth_signTypedData_v4 payload the user's wallet signs. */
export function registerSessionKeyTypedData(message: RegisterSessionKeyMessage) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      RegisterSessionKey: REGISTER_SESSION_KEY,
    },
    domain: DOMAIN,
    primaryType: "RegisterSessionKey" as const,
    message,
  };
}

/**
 * Checks that `signature` is the wallet's signature over `message`, and returns the
 * signed body the relayer takes, or null if it isn't.
 */
export async function signedRegistration(
  message: RegisterSessionKeyMessage,
  signature: Hex,
) {
  const valid = await verifyTypedData({
    address: message.user as Address,
    domain: DOMAIN,
    types: { RegisterSessionKey: REGISTER_SESSION_KEY },
    primaryType: "RegisterSessionKey",
    message: {
      user: message.user as Address,
      key: message.key as Address,
      expiry: BigInt(message.expiry),
      feeAddress: message.feeAddress as Address,
      nonce: BigInt(message.nonce),
      deadline: BigInt(message.deadline),
    },
    signature,
  }).catch(() => false);
  if (!valid) return null;

  const { r, s, yParity } = parseSignature(signature);
  return {
    ...message,
    v: String(27 + (yParity ?? 0)),
    r: r.toLowerCase(),
    s: s.toLowerCase(),
  };
}
