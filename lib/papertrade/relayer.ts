import "server-only";

import { PAPERTRADE_URL, USER_AGENT } from "./config";

export class RelayerError extends Error {
  constructor(
    readonly code: string,
    readonly reason: string | undefined,
  ) {
    super(reason ? `${code}: ${reason}` : code);
  }
}

const BUILD_ID_TTL_MS = 10 * 60 * 1000;
let buildId: { value: Promise<string | null>; fetchedAt: number } | undefined;

/**
 * Papertrade's app sends its build ID on every request (X-Papertrade-Build). It
 * changes with each deploy, so read it from the live app and refresh it now and then.
 */
function appBuildId() {
  if (!buildId || Date.now() - buildId.fetchedAt > BUILD_ID_TTL_MS) {
    buildId = { value: fetchBuildId(), fetchedAt: Date.now() };
  }
  return buildId.value;
}

async function fetchBuildId() {
  try {
    const headers = { "User-Agent": USER_AGENT };
    const html = await (await fetch(`${PAPERTRADE_URL}/`, { headers })).text();
    const chunk = html.match(/\/assets\/build-[\w-]+\.js/)?.[0];
    if (!chunk) return null;
    const js = await (await fetch(PAPERTRADE_URL + chunk, { headers })).text();
    return js.match(/^var \w+=`([0-9a-f]{8,40})`/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Submits a signed intent to papertrade's relayer, which queues it and batches it onchain. */
export async function submitIntent(
  action: "registerSessionKey",
  signed: Record<string, unknown>,
) {
  const build = await appBuildId();
  const res = await fetch(`${PAPERTRADE_URL}/intents`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      ...(build ? { "X-Papertrade-Build": build } : {}),
    },
    body: JSON.stringify({ action, signed }),
    signal: AbortSignal.timeout(35_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error || body.ok === false) {
    const code =
      body.code ??
      body.error ??
      (res.status === 429 ? "rate_limited" : `http_${res.status}`);
    throw new RelayerError(String(code), body.reason ?? undefined);
  }
}
