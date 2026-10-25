import "server-only";

import { cookies } from "next/headers";
import { signCookie, verifyCookie } from "./crypto";
import { sql } from "./db";

const SESSION_COOKIE = "capypaper_session";
const SESSION_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

export type WalletSession = {
  wallet: string;
  sessionKeyAddress: string;
  encryptedSessionKey: string;
  expiresAt: Date | null;
  createdAt: Date;
};

export async function findSession(wallet: string) {
  const [row] = await sql<WalletSession[]>`
    select
      wallet_address as "wallet",
      session_key_address as "sessionKeyAddress",
      encrypted_session_key as "encryptedSessionKey",
      expires_at as "expiresAt",
      created_at as "createdAt"
    from wallet_sessions
    where wallet_address = ${wallet}
  `;
  return row ?? null;
}

/**
 * Stores the wallet's session key. Switching to a different key clears the
 * confirmed expiry, since that belonged to the old key. Returns the row's
 * created_at, which identifies this connection in the session cookie.
 */
export async function saveSessionKey(
  wallet: string,
  sessionKeyAddress: string,
  encryptedSessionKey: string,
) {
  const [row] = await sql<{ createdAt: Date }[]>`
    insert into wallet_sessions (wallet_address, session_key_address, encrypted_session_key)
    values (${wallet}, ${sessionKeyAddress}, ${encryptedSessionKey})
    on conflict (wallet_address) do update set
      session_key_address = excluded.session_key_address,
      encrypted_session_key = excluded.encrypted_session_key,
      expires_at = case
        when wallet_sessions.session_key_address = excluded.session_key_address
          then wallet_sessions.expires_at
      end,
      updated_at = now()
    returning created_at as "createdAt"
  `;
  return row.createdAt;
}

export async function saveExpiry(
  wallet: string,
  sessionKeyAddress: string,
  expiresAt: Date,
) {
  await sql`
    update wallet_sessions
    set expires_at = ${expiresAt}, updated_at = now()
    where wallet_address = ${wallet} and session_key_address = ${sessionKeyAddress}
  `;
}

/**
 * Reserves the next trade nonce for the wallet. The counter starts at a random
 * multiple of 256 (a fresh bitmap word), like papertrade's own app.
 */
export async function reserveNonce(wallet: string) {
  const [a, b, c] = crypto.getRandomValues(new Uint8Array(3));
  const start = ((a << 16) | (b << 8) | c || 1) * 256;
  const [row] = await sql<{ nonce: string }[]>`
    update wallet_sessions
    set next_nonce = coalesce(next_nonce, ${start}) + 1
    where wallet_address = ${wallet}
    returning next_nonce - 1 as nonce
  `;
  if (!row) throw new Error("wallet session not found");
  return BigInt(row.nonce);
}

export async function deleteSession(wallet: string) {
  await sql`delete from wallet_sessions where wallet_address = ${wallet}`;
}

export async function setSessionCookie(wallet: string, createdAt: Date) {
  (await cookies()).set(
    SESSION_COOKIE,
    signCookie(`${wallet}:${createdAt.getTime()}`),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SEC,
    },
  );
}

export async function deleteSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in wallet's session, or null if the visitor hasn't connected a wallet. */
export async function currentSession() {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const value = cookie ? verifyCookie(cookie) : null;
  if (!value) return null;

  const [wallet, createdAt] = value.split(":");
  const session = await findSession(wallet);
  // Disconnecting deletes the row, so a cookie from an earlier connection no longer matches.
  if (!session || session.createdAt.getTime() !== Number(createdAt)) return null;
  return session;
}
