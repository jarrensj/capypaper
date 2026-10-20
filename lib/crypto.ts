import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function keyFromEnv(name: "SESSION_SECRET" | "SESSION_KEY_ENCRYPTION_KEY") {
  const key = Buffer.from(process.env[name] ?? "", "base64");
  if (key.length !== 32) {
    throw new Error(`${name} must be 32 bytes, base64-encoded (openssl rand -base64 32)`);
  }
  return key;
}

function seal(key: Buffer, plaintext: string, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv).setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

function open(key: Buffer, sealed: string, aad: string) {
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"))
      .setAAD(Buffer.from(aad))
      .setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Encrypts a session key's private key for storage, bound to the wallet it trades for. */
export function encryptSessionKey(privateKey: string, wallet: string) {
  return seal(keyFromEnv("SESSION_KEY_ENCRYPTION_KEY"), privateKey, wallet);
}

export function decryptSessionKey(sealed: string, wallet: string) {
  return open(keyFromEnv("SESSION_KEY_ENCRYPTION_KEY"), sealed, wallet);
}

/** Encrypts short-lived state kept in a cookie. `purpose` stops one cookie being replayed as another. */
export function encryptCookie(value: unknown, purpose: string) {
  return seal(keyFromEnv("SESSION_SECRET"), JSON.stringify(value), purpose);
}

export function decryptCookie<T>(sealed: string, purpose: string): T | null {
  const json = open(keyFromEnv("SESSION_SECRET"), sealed, purpose);
  return json === null ? null : (JSON.parse(json) as T);
}

/** Signs `value` so it can be stored in a cookie and trusted when read back. */
export function signCookie(value: string) {
  const mac = createHmac("sha256", keyFromEnv("SESSION_SECRET")).update(value).digest("base64url");
  return `${value}.${mac}`;
}

export function verifyCookie(signed: string) {
  const dot = signed.lastIndexOf(".");
  if (dot === -1) return null;
  const value = signed.slice(0, dot);
  const expected = Buffer.from(signCookie(value).slice(dot + 1));
  const actual = Buffer.from(signed.slice(dot + 1));
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? value : null;
}
