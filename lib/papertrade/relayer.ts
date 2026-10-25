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

/**
 * Submits a signed intent to papertrade's relayer, which queues it and batches it
 * onchain. Returns the relayer's intent ID, which the account stream reports the
 * intent under.
 */
export async function submitIntent(
  action: "registerSessionKey" | "openPosition" | "closePositions",
  signed: Record<string, unknown>,
): Promise<string | undefined> {
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
  return typeof body.intentId === "string" ? body.intentId.toLowerCase() : undefined;
}

/** A message for the person who made the request, for an error from submitIntent. */
export function relayerErrorMessage(error: unknown) {
  if (!(error instanceof RelayerError)) {
    return "Couldn't reach papertrade. Try again in a minute.";
  }
  switch (error.reason ?? error.code) {
    case "noDeposit":
      return "Deposit at least 10 USDC on papertrade before connecting.";
    case "sessionKeyLimit":
      return "This wallet has too many papertrade session keys. Revoke one on papertrade, then try again.";
    case "alreadyQueued":
      return "That's already queued on papertrade. Wait a minute, then refresh.";
    case "unauthorized_intent":
      return "Papertrade rejected the signature. Renew your session and try again.";
    case "deadline_expired":
      return "The request expired before it reached papertrade. Try again.";
    case "rate_limited":
      return "Papertrade is rate limiting requests. Try again in a minute.";
    case "intake_action_paused":
      return "Papertrade has paused trading for now.";
    case "belowMinimum":
      return "Margin is below papertrade's minimum.";
    case "belowMinimumNotional":
      return "Margin × leverage is below papertrade's minimum position size.";
    case "leverageTooHigh":
      return "Leverage is above papertrade's maximum for this market.";
    case "positionTooLarge":
      return "That position is bigger than papertrade allows.";
    case "openInterest":
      return "That side of the market is at its open interest cap. Try a smaller size.";
    case "funding":
      return "You don't have enough available balance for that margin.";
    case "noOpenPositions":
      return "Those positions are already closed.";
    default:
      return `Papertrade rejected the request (${error.message}).`;
  }
}
