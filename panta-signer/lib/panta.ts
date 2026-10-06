/**
 * Typed client for the Panta prediction-market API.
 *
 * Every write on Panta is a *session*, not a single call:
 *
 *   quote -> build (unsigned tx, or instructions) -> the user's wallet signs
 *         -> WE broadcast on our RPC -> confirm with Panta by handing it the
 *            signature
 *
 * That "we broadcast" step is the whole reason panta-signer exists. Panta's
 * custody model is, in their words: "Panta cooks the transaction. The user
 * signs. You file it on-chain. You broadcast on your RPC, then tell Panta the
 * signature." The RPC we broadcast on is Solami -- see lib/solami.ts.
 *
 * Three things the API is strict about, all of them encoded here rather than
 * left to the caller to remember:
 *
 *   1. Every path ends in a trailing slash. `assertTrailingSlash` makes that a
 *      loud programming error instead of a silent 404.
 *   2. Failures come back as `{ code, message, field? }`. Switch on `code`,
 *      not the HTTP status -- `PantaError` carries both.
 *   3. The session ids are short-lived: a quote is good for ~90s and an order
 *      for ~120s, and a blockhash expires in ~60s. Callers must be ready to
 *      requote on `QUOTE_STALE` rather than retrying a dead session.
 *
 * Amount units differ between the two write flows and that is a genuine
 * footgun, so it is called out at each call site:
 *   - creating a market: USDC *base units* as an integer string ("50000000")
 *   - a primary buy:     human-readable *decimal* string ("20.00")
 */

import { pantaApiKey, pantaBaseUrl } from "./env.js";
import { withTimeout } from "./withTimeout.js";

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Cloudflare fronts live-api.panta.market and bans non-browser user agents
 * outright: a default client gets HTTP 403, error 1010
 * ("browser_signature_banned"), retryable false, and the request never reaches
 * Panta. It presents as an authentication failure and is not one, which is a
 * good way to lose an afternoon.
 *
 * Node's global fetch sends "User-Agent: node" by default -- precisely the kind
 * of signature that gets banned -- so we always identify explicitly.
 */
const USER_AGENT =
  process.env.PANTA_USER_AGENT ?? "Overline/0.1 (+https://github.com/yeziR4/fpl)";

/** An error Panta itself returned, or a transport failure wrapped as one. */
export class PantaError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field?: string;

  constructor(code: string, message: string, status: number, field?: string) {
    super(message);
    this.name = "PantaError";
    this.code = code;
    this.status = status;
    this.field = field;
  }

  /** True when the caller should start a fresh quote rather than retry. */
  get isStaleSession(): boolean {
    return this.code === "QUOTE_STALE";
  }
}

function assertTrailingSlash(path: string): void {
  const pathOnly = path.split("?")[0];
  if (!pathOnly.endsWith("/")) {
    throw new Error(`Panta paths require a trailing slash (got "${path}")`);
  }
}

interface PantaFetchOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Use a JWT instead of the API key. Only for account/key management. */
  bearer?: string;
}

async function pantaFetch<T>(path: string, options: PantaFetchOptions = {}): Promise<T> {
  assertTrailingSlash(path);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  if (options.bearer) {
    headers.Authorization = `Bearer ${options.bearer}`;
  } else {
    headers["X-Api-Key"] = pantaApiKey();
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await withTimeout(
      fetch(pantaBaseUrl() + path, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
      REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    throw new PantaError(
      "TRANSPORT_ERROR",
      `Could not reach Panta at ${path}: ${String(error)}`,
      502,
    );
  }

  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : `HTTP_${response.status}`;
    const message =
      typeof record.message === "string" ? record.message : text.slice(0, 300) || response.statusText;
    const field = typeof record.field === "string" ? record.field : undefined;
    throw new PantaError(code, message, response.status, field);
  }

  return payload as T;
}

// ------------------------------------------------------------------ reads

export interface PantaMarket {
  marketId: string;
  question?: string;
  status?: string;
  yesPrice?: number;
  noPrice?: number;
  [key: string]: unknown;
}

/** The catalog. `status: "primary"` is the acquisition window -- the only
 * window our app can act in, because Panta exposes no secondary-market (CLOB)
 * trading through the API. */
export function listMarkets(status?: "primary" | "secondary"): Promise<PantaMarket[]> {
  const query = status ? `?status=${status}` : "";
  return pantaFetch<PantaMarket[]>(`/markets/${query}`);
}

export function getMarket(marketId: string): Promise<PantaMarket> {
  return pantaFetch<PantaMarket>(`/markets/${marketId}/`);
}

export function marketTrades(marketId: string): Promise<unknown> {
  return pantaFetch<unknown>(`/markets/${marketId}/trades/`);
}

/**
 * Positions come back as share counts, never as USD. To show a value you have
 * to join against the market price yourself:
 *
 *   open value ~= shares * (side === "yes" ? yesPrice : noPrice)
 *   after resolution: a winner is ~shares * 1 USDC, a loser ~0
 */
export function positions(wallet: string): Promise<unknown> {
  return pantaFetch<unknown>(`/positions/?wallet=${encodeURIComponent(wallet)}`);
}

/** Panta's own attribution number for our account: volumeUsdcBase.
 * This is how we answer the "Traction" judging criterion with a figure the
 * sponsor computes rather than one we assert. */
export function metrics(): Promise<unknown> {
  return pantaFetch<unknown>("/account/metrics/");
}

// --------------------------------------------------------- create a market

/**
 * Fields Panta's quote endpoint accepts. The docs name the concepts; confirm
 * the exact key spellings against
 * https://docs.panta.market/api-reference/markets/quote before the first live
 * create, because the smoke test only exercises read paths.
 */
export interface MarketSpec {
  question: string;
  /** ISO 8601. Must respect the on-chain minimumStartDelay (~3600s ahead of
   * now) unless this is a breaking market with eventInProgress set. */
  startTime: string;
  /** ISO 8601. When the outcome is determined. */
  resolveTime: string;
  marketType: "standard" | "breaking";
  /** Public catalog image, ~1024x1024. Required for a market to be listed. */
  imageUrl: string;
  region?: string;
  /** Resolution source of truth. For FPL markets this must point at
   * fantasy.premierleague.com so the AI Resolution Agent reads fantasy points
   * rather than real-world match stats -- those are different numbers, and
   * getting it wrong silently misresolves every market we create. */
  oracle?: string;
  eventInProgress?: boolean;
}

/** Step 1. Returns `createId`, good for roughly five minutes. */
export function quoteMarket(spec: MarketSpec): Promise<{ createId: string } & Record<string, unknown>> {
  return pantaFetch("/markets/quote/", { method: "POST", body: spec });
}

/**
 * Step 2. Returns an unsigned VersionedTransaction plus a recent blockhash.
 * The client deserializes, the wallet signs, and the signed bytes come back to
 * api/market-register.ts to be broadcast through Solami.
 *
 * Do not edit accounts or fee amounts between quote and register -- Panta
 * checks the chain against the quote and will reject the mismatch.
 */
export function buildMarket(createId: string): Promise<{ transaction: string } & Record<string, unknown>> {
  return pantaFetch("/markets/build/", { method: "POST", body: { createId } });
}

/** Step 3. Idempotent for the same createId + signature, so a retry after a
 * network blip is safe. */
export function registerMarket(
  createId: string,
  signature: string,
): Promise<Record<string, unknown>> {
  return pantaFetch("/markets/register/", { method: "POST", body: { createId, signature } });
}

// ----------------------------------------------------------- a primary buy

export interface OrderQuoteInput {
  marketId: string;
  side: "yes" | "no";
  /** HUMAN-READABLE decimal string, e.g. "20.00". Not base units. Panta
   * rejects anything under $0.10 with AMOUNT_TOO_SMALL. */
  amountUsdc: string;
  wallet: string;
  /** Optional attribution id; defaults to the authenticated account. */
  userId?: string;
}

/** Step 1. Returns `quoteId`, good for ~90 seconds. Move fast. */
export function quoteOrder(
  input: OrderQuoteInput,
): Promise<{ quoteId: string } & Record<string, unknown>> {
  return pantaFetch("/orders/quote/", { method: "POST", body: input });
}

/**
 * Step 2. Unlike market creation, this returns *instructions*, not an
 * assembled transaction. The client must compile a versioned transaction from
 * `instructions` + `recentBlockhash` before it can be signed. Two different
 * assembly paths in one integration -- easy to miss.
 *
 * Returns `orderId`, good for ~120 seconds.
 */
export function buildOrder(
  quoteId: string,
  userId?: string,
): Promise<{ orderId: string; instructions: unknown[]; recentBlockhash: string } & Record<string, unknown>> {
  return pantaFetch("/orders/build/", { method: "POST", body: { quoteId, userId } });
}

/** Step 3. Idempotent for the same orderId + signature. */
export function submitOrder(orderId: string, signature: string): Promise<Record<string, unknown>> {
  return pantaFetch("/primaryordersubmit/", { method: "POST", body: { orderId, signature } });
}

/** Optional but useful: ask Panta to re-check a transaction on chain.
 * Verification is fail-closed -- TX_NOT_FOUND, TX_FAILED, TX_MISMATCH,
 * TX_FEE_MISMATCH -- so a 200 here is real evidence, not a receipt. */
export function verifyOrder(signature: string): Promise<Record<string, unknown>> {
  return pantaFetch("/orders/verify/", { method: "POST", body: { signature } });
}

/** Trade attribution. Accepts primary buys and win claims only. Reporting a
 * creator-fee claim here fails with TX_MISMATCH by design. */
export function reportTrade(input: {
  signature: string;
  kind: "buy" | "claim";
  [key: string]: unknown;
}): Promise<Record<string, unknown>> {
  return pantaFetch("/trades/", { method: "POST", body: input });
}

// ---------------------------------------------------------------- claims

/** Build win-claim instructions for a resolved, claimable market. Same
 * compile -> sign -> broadcast pattern as a primary buy. */
export function buildWinClaim(input: {
  marketId: string;
  wallet: string;
}): Promise<{ instructions: unknown[]; recentBlockhash: string } & Record<string, unknown>> {
  return pantaFetch("/claim/build/", { method: "POST", body: input });
}

/** Creator royalties, claimable once a market's primary phase ends. Do NOT
 * report this one through /trades/ -- Panta rejects it. */
export function buildCreatorFeeClaim(input: {
  marketId: string;
  wallet: string;
}): Promise<{ instructions: unknown[]; recentBlockhash: string } & Record<string, unknown>> {
  return pantaFetch("/claim/creator-fees/build/", { method: "POST", body: input });
}
