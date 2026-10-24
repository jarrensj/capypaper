"use server";

import { refresh } from "next/cache";
import { isAddress, isHex, zeroAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decryptCookie, encryptCookie, encryptSessionKey } from "@/lib/crypto";
import { readAccount } from "@/lib/papertrade/account";
import { builderFee } from "@/lib/papertrade/builder";
import { relayerErrorMessage, submitIntent } from "@/lib/papertrade/relayer";
import {
  registerSessionKeyMessage,
  registerSessionKeyTypedData,
  signedRegistration,
  type RegisterSessionKeyMessage,
} from "@/lib/papertrade/session-key";
import {
  currentSession,
  deleteSession,
  deleteSessionCookie,
  findSession,
  saveExpiry,
  saveSessionKey,
  setSessionCookie,
} from "@/lib/session";

const PENDING_PURPOSE = "pending-registration";
const PENDING_TTL_MS = 10 * 60 * 1000;

type Pending = {
  message: RegisterSessionKeyMessage;
  encryptedSessionKey: string;
  expiresAtMs: number;
};

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Step 1 of connecting (or renewing): picks the wallet's session key, creating one
 * if it has none, and returns the registration for the wallet to sign. The key
 * and message travel back to completeConnect encrypted, so nothing is stored
 * until the wallet has signed.
 */
export async function prepareConnect(
  address: string,
): Promise<Result<{ typedData: ReturnType<typeof registerSessionKeyTypedData>; pending: string }>> {
  if (!isAddress(address)) {
    return { ok: false, error: "Your wallet returned an invalid address." };
  }
  const wallet = address.toLowerCase() as Address;

  const existing = await findSession(wallet);
  let sessionKeyAddress: string;
  let encryptedSessionKey: string;
  if (existing) {
    sessionKeyAddress = existing.sessionKeyAddress;
    encryptedSessionKey = existing.encryptedSessionKey;
  } else {
    const privateKey = generatePrivateKey();
    sessionKeyAddress = privateKeyToAccount(privateKey).address.toLowerCase();
    encryptedSessionKey = encryptSessionKey(privateKey, wallet);
  }

  const fee = await builderFee();
  const message = registerSessionKeyMessage(
    wallet,
    sessionKeyAddress as Address,
    fee?.address ?? zeroAddress,
  );
  const pending: Pending = {
    message,
    encryptedSessionKey,
    expiresAtMs: Date.now() + PENDING_TTL_MS,
  };
  return {
    ok: true,
    typedData: registerSessionKeyTypedData(message),
    pending: encryptCookie(pending, PENDING_PURPOSE),
  };
}

/**
 * Step 2: checks the wallet's signature, stores the session key, submits the
 * registration to papertrade and signs the visitor in. Papertrade confirms the
 * registration a few seconds later; poll confirmRegistration for that.
 */
export async function completeConnect(
  pendingToken: string,
  signature: string,
): Promise<Result<{ expiry: number }>> {
  const pending = decryptCookie<Pending>(pendingToken, PENDING_PURPOSE);
  if (!pending || pending.expiresAtMs < Date.now()) {
    return { ok: false, error: "That connection request expired. Try again." };
  }
  if (!isHex(signature)) {
    return { ok: false, error: "Your wallet returned an invalid signature." };
  }
  const { message, encryptedSessionKey } = pending;
  const signed = await signedRegistration(message, signature);
  if (!signed) {
    return { ok: false, error: "That signature doesn't match your wallet." };
  }

  // Store the key before papertrade can accept it, so an accepted key is never lost.
  const createdAt = await saveSessionKey(message.user, message.key, encryptedSessionKey);
  try {
    await submitIntent("registerSessionKey", signed);
  } catch (error) {
    return { ok: false, error: relayerErrorMessage(error) };
  }

  await setSessionCookie(message.user, createdAt);
  return { ok: true, expiry: Number(message.expiry) };
}

/** Step 3: records the new expiry once papertrade's account stream shows it. */
export async function confirmRegistration(
  expiry: number,
): Promise<Result<{ confirmed: boolean }>> {
  const session = await currentSession();
  if (!session) return { ok: false, error: "You're not signed in." };

  const account = await readAccount(session.wallet).catch(() => null);
  const registered = account?.sessionKeys.get(session.sessionKeyAddress);
  // During a renewal the old registration is still live, so wait for the new expiry.
  if (registered === undefined || registered < expiry) {
    return { ok: true, confirmed: false };
  }

  await saveExpiry(session.wallet, session.sessionKeyAddress, new Date(registered * 1000));
  refresh();
  return { ok: true, confirmed: true };
}

/**
 * Signs out and deletes capypaper's copy of the session key, so capypaper can no
 * longer trade for the wallet. The key stays registered on papertrade until it
 * expires.
 */
// TODO: also offer revoking the key on papertrade. That's a wallet transaction to
// SessionKeyManager.revokeSessionKey(key), so it needs a little HYPE for gas.
export async function disconnect() {
  const session = await currentSession();
  if (session) await deleteSession(session.wallet);
  await deleteSessionCookie();
}
