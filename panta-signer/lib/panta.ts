/**
 * Typed client for the Panta prediction-market API.
 *
 * Every write on Panta is a *session*, not a single call:
 *
 *   quote -> build (unsigned tx, or instructions) -> the user's wallet signs
 *         -> WE broadcast on our RPC -> confirm with Panta by handing it the
 *            signature
 *
 * That "we broadcast" step is why panta-signer exists. Panta's custody model
 * is, in their words: "Panta cooks the transaction. The user signs. You file it
 * on-chain. You broadcast on your RPC, then tell Panta the signature." The RPC
 * we broadcast on is Solami -- see lib/solami.ts.
 *
 * EVERY PATH AND SHAPE HERE IS VERIFIED against the live API and its reference
 * pages, not inferred. An earlier revision guessed the paths from the docs'
 * navigation labels and was wrong on all of them: `/markets/quote/` collides
 * with `/markets/{marketId}/` and returns 405, and the real route is
 * `/markets/create/quote/`. It also invented an `oracle` string where the API
 * takes `resolutionRule` plus a `sourcesOfTruth` array, and assumed ISO 8601
 * timestamps where the API takes unix seconds. Assume nothing here is
 * re-guessed without a free dry run first.
 *
 * Three things the API is strict about, all encoded here rather than left to
 * the caller:
 *
 *   1. Trailing slashes on every path, except the concatenated `primaryorder*`
 *      family which has no separator at all.
 *   2. Failures come back as `{ code, message, field? }`. Switch on `code`, not
 *      the HTTP status.
 *   3. Session ids are short-lived: a quote is ~90s, an order ~120s, and a
 *      blockhash ~60s. Be ready to requote on QUOTE_STALE rather than retrying
 *      a dead session.
 *
 * Amount units differ between the two write flows, and that is a real footgun:
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
  /**
   * The `fields` map Panta attaches to real validation failures, e.g.
   * `{ category: ["This field is required."] }`. Its PRESENCE is the
   * discriminator between a caller mistake and a transient server fault --
   * see isTransientQuoteFailure.
   */
  readonly fields?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: number,
    field?: string,
    fields?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PantaError";
    this.code = code;
    this.status = status;
    this.field = field;
    this.fields = fields;
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
      typeof record.message === "string"
        ? record.message
        : typeof record.detail === "string"
          ? record.detail
          : text.slice(0, 300) || response.statusText;
    const field = typeof record.field === "string" ? record.field : undefined;
    const fields =
      record.fields && typeof record.fields === "object"
        ? (record.fields as Record<string, unknown>)
        : undefined;
    throw new PantaError(code, message, response.status, field, fields);
  }

  return payload as T;
}

// ------------------------------------------------------------------ reads

/**
 * A market as the catalog returns it. Field names read off a live
 * `GET /markets/` response.
 */
export interface PantaMarket {
  marketId: string;
  /** Free-text vertical, e.g. "science", "crypto". */
  category?: string;
  title?: string;
  description?: string;
  images?: string[];
  /** "primary" during the acquisition window, "secondary" after it. */
  phase?: string;
  marketType?: "standard" | "breaking";
  /** Unix seconds. */
  startTime?: number;
  endTime?: number;
  resolutionTime?: number;
  region?: string;
  resolved?: boolean;
  status?: string;
  /** A decimal string, e.g. "0.00" -- not a number. */
  volumeUsdc?: string;
  campaignId?: string | null;
  createdByPartner?: boolean;
  /** All six are null on markets with no live pricing. */
  yesPrice?: number | null;
  noPrice?: number | null;
  primaryYesPrice?: number | null;
  primaryNoPrice?: number | null;
  secondaryYesPrice?: number | null;
  secondaryNoPrice?: number | null;
  [key: string]: unknown;
}

/**
 * The catalog is cursor-paginated: `{ items, nextCursor }`, NOT a bare array.
 * An earlier revision assumed an array, which reported an empty catalog
 * against one that returns twenty markets.
 */
export interface MarketPage {
  items: PantaMarket[];
  nextCursor: string | null;
}

export function listMarkets(
  options: { status?: "primary" | "secondary"; cursor?: string; limit?: number } = {},
): Promise<MarketPage> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  return pantaFetch<MarketPage>(`/markets/${query}`);
}

/** Walk the cursor to the end, bounded so a server bug cannot spin here. */
export async function listAllMarkets(
  status?: "primary" | "secondary",
  maxPages = 20,
): Promise<PantaMarket[]> {
  const all: PantaMarket[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listMarkets({ status, cursor });
    all.push(...(result.items ?? []));
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return all;
}

export function getMarket(marketId: string): Promise<PantaMarket> {
  return pantaFetch<PantaMarket>(`/markets/${marketId}/`);
}

export function marketTrades(marketId: string): Promise<unknown> {
  return pantaFetch<unknown>(`/markets/${marketId}/trades/`);
}

/** The catalog's own category vocabulary, so we pick "sports" only if it exists. */
export function categories(): Promise<unknown> {
  return pantaFetch<unknown>("/markets/categories/");
}

/**
 * `wallet` is REQUIRED. A bare call returns
 * `400 { code: "INVALID_MARKET_PARAMS", fields: { wallet: ["This field is required."] } }`
 * which reads like a Panta defect and is not one.
 *
 * The per-position objects are still unverified: every live market currently
 * sits in the secondary phase, the API trades primary only, so no position has
 * yet existed to look at. The summary block below is real.
 */
export interface PantaPositions {
  wallet: string;
  positions: unknown[];
  summary?: {
    currentValueUsdc?: string;
    currentValueUsdcBase?: string;
    /** USDC contributed during the primary phase. */
    primaryContributedUsdc?: string;
    primaryContributedUsdcBase?: string;
    valuedPositions?: number;
    unvaluedPositions?: number;
  };
  [key: string]: unknown;
}

export function positions(wallet: string): Promise<PantaPositions> {
  return pantaFetch<PantaPositions>(`/positions/?wallet=${encodeURIComponent(wallet)}`);
}

/** Panta's own attribution number for us: `volumeUsdcBase`. This is how the
 * "Traction" judging criterion gets answered with the sponsor's figure rather
 * than our claim. */
export function metrics(): Promise<unknown> {
  return pantaFetch<unknown>("/account/metrics/");
}

// --------------------------------------------------------- create a market

/**
 * The create-market request body, verified against
 * https://docs.panta.market/api-reference/markets/quote.
 *
 * Note how far this is from the obvious guess: `resolutionRule` is prose
 * describing how the market settles, `sourcesOfTruth` is an array of URLs the
 * AI Resolution Agent reads, and all three times are UNIX SECONDS integers --
 * not ISO 8601 strings. `title` is separate from `question` and is what the
 * catalog displays.
 *
 * `wallet` is the creator's address and is required at quote AND build; the
 * transaction it produces is signed by that wallet, which is why our operator
 * keypair supplies it.
 */
export interface MarketSpec {
  /** The creator's Solana address. Required. */
  wallet: string;
  /** The full question the market asks. */
  question: string;
  /** Prose rule for settling it, e.g. "Resolves to YES if the official FPL
   * site credits the player with 10 or more points for the gameweek." */
  resolutionRule: string;
  /** URLs the resolution agent reads. For an FPL market this MUST include
   * fantasy.premierleague.com: real-world match stats are not fantasy points,
   * and naming the wrong source misresolves every market we create. */
  sourcesOfTruth: string[];
  category: string;
  /** Unix seconds. Must clear the on-chain minimumStartDelay (Panta says
   * typically 3600s ahead) unless eventInProgress is set on a breaking market. */
  startTime: number;
  /** Unix seconds. */
  endTime: number;
  /** Unix seconds. When the outcome is determined. */
  resolutionTime: number;
  marketType: "standard" | "breaking";
  /** Short catalog label. This is what appears in listings, not `question`. */
  title: string;
  description?: string;
  /** Public catalog image, ~1024x1024. */
  imageUrl: string;
  region?: string;
  eventInProgress?: boolean;
  [key: string]: unknown;
}

export interface MarketQuote {
  createId: string;
  expectedEventPda?: string;
  /** USDC base units. 50000000 = 50 USDC for a standard market. */
  paymentUsdc?: string;
  liquidityInjectionUsdc?: string;
  platformRevenueUsdc?: string;
  marketType?: string;
  expiresAt?: string;
  blockhashExpiryHintSec?: number;
  [key: string]: unknown;
}

/**
 * Panta intermittently fails a create-session step with
 * `400 INVALID_MARKET_PARAMS` and a bare "unexpected create <step> failure --
 * check server logs". Seen on BOTH quote and build, with the step named in the
 * message.
 *
 * Measured 2026-10-07, and it is worse than first thought: it fires on roughly
 * HALF of create-quote requests. Seven consecutive attempts failed, then the
 * next two succeeded with identical payloads. Transient, not validation.
 *
 * `fields` is the discriminator. Every genuine validation failure carries one
 * ("category: This field is required."); this never does. A fields-bearing
 * error is the caller's fault and must fail fast.
 */
export function isTransientPantaFailure(error: unknown): boolean {
  return error instanceof PantaError && error.code === "INVALID_MARKET_PARAMS" && !error.fields;
}

/**
 * How many times to retry that transient failure.
 *
 * At three attempts a single step succeeds about 87% of the time, and the
 * create flow is three steps, so the whole flow would fail roughly one run in
 * three -- not acceptable when a run costs 20 USDC, non-refundable.
 *
 * Six puts a single step at ~98% and the flow at ~95%.
 *
 * Do not raise it much further: the API is rate limited to 30 requests per
 * window (x-ratelimit-limit), and six attempts across three steps is 18.
 */
export const TRANSIENT_ATTEMPTS = 6;

/**
 * Retry something free and repeatable past the transient failure above.
 *
 * NEVER wrap anything that broadcasts or spends. A retried broadcast can pay a
 * creation fee twice. Register is safe because it is idempotent on
 * createId + signature; sendTransaction is not safe and is deliberately not
 * wrapped.
 */
async function withTransientRetry<T>(
  label: string,
  run: () => Promise<T>,
  attempts = TRANSIENT_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isTransientPantaFailure(error) || attempt === attempts - 1) throw error;
      const delayMs = 750 * (attempt + 1);
      console.warn(`  ${label}: transient Panta failure, retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

/**
 * Step 1. Returns `createId`, which lives about five minutes.
 *
 * Retries the transient failure above and surfaces real validation errors
 * immediately. Quote costs nothing and only reserves a short-lived session.
 */
export function quoteMarket(spec: MarketSpec, attempts = TRANSIENT_ATTEMPTS): Promise<MarketQuote> {
  return withTransientRetry(
    "quote",
    () => pantaFetch<MarketQuote>("/markets/create/quote/", { method: "POST", body: spec }),
    attempts,
  );
}

export interface MarketBuild {
  createId: string;
  expectedEventPda?: string;
  /** base64 VersionedTransaction, already assembled -- unlike a primary buy,
   * which returns bare instructions the client must compile itself. */
  transaction: string;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
  blockhashExpiryHintSec?: number;
  buildFingerprint?: string;
  paymentUsdc?: string;
  marketType?: string;
  derived?: { event?: string; vaultAuthority?: string; marketConfig?: string };
  expiresAt?: string;
  [key: string]: unknown;
}

/** Step 2. `wallet` must match the one quoted. Do not edit accounts or fee
 * amounts afterwards: register checks the chain against the quote.
 *
 * Retried for the same transient failure as quote -- observed hitting this
 * step too, with "unexpected create build failure". Build is free and
 * repeatable. */
export function buildMarket(
  createId: string,
  wallet: string,
  attempts = TRANSIENT_ATTEMPTS,
): Promise<MarketBuild> {
  return withTransientRetry(
    "build",
    () =>
      pantaFetch<MarketBuild>("/markets/create/build/", {
        method: "POST",
        body: { createId, wallet },
      }),
    attempts,
  );
}

export interface MarketRegistration {
  createId: string;
  /** This IS the event PDA, and it is the marketId used everywhere else. */
  marketId: string;
  status?: string;
  signature?: string;
  category?: string;
  title?: string;
  images?: string[];
  [key: string]: unknown;
}

/** Step 3. Idempotent for the same createId + signature, so a retry after a
 * network blip is safe -- and so is a retry past the transient failure, which
 * is why this one is wrapped. */
export function registerMarket(
  createId: string,
  signature: string,
  attempts = TRANSIENT_ATTEMPTS,
): Promise<MarketRegistration> {
  return withTransientRetry(
    "register",
    () =>
      pantaFetch<MarketRegistration>("/markets/register/", {
        method: "POST",
        body: { createId, signature },
      }),
    attempts,
  );
}

// ----------------------------------------------------------- a primary buy

export interface OrderQuoteInput {
  wallet: string;
  marketId: string;
  side: "yes" | "no";
  /** HUMAN-READABLE decimal string, e.g. "20.00". Not base units. Panta
   * rejects anything under $0.10 -- AMOUNT_TOO_SMALL at quote time. */
  amountUsdc: string;
  userId?: string;
}

export interface OrderQuote {
  quoteId: string;
  marketId?: string;
  side?: string;
  amountUsdc?: string;
  shares?: string;
  avgPrice?: string;
  feeUsdc?: string;
  expiresAt?: string;
  blockhashExpiryHintSec?: number;
  [key: string]: unknown;
}

/** Step 1. Returns `quoteId`, good for about 90 seconds. */
export function quoteOrder(input: OrderQuoteInput): Promise<OrderQuote> {
  return pantaFetch<OrderQuote>("/primaryorderquote/", { method: "POST", body: input });
}

export interface OrderBuild {
  orderId: string;
  quoteId?: string;
  wallet?: string;
  marketId?: string;
  side?: string;
  amountUsdc?: string;
  expectedShares?: string;
  feeUsdc?: string;
  status?: string;
  /** NOT a transaction. Compile a versioned transaction from these plus
   * `recentBlockhash`, then sign. This asymmetry with market creation is the
   * easiest thing in the integration to get wrong. */
  instructions: unknown[];
  derived?: { event?: string; vaultAuthority?: string };
  recentBlockhash: string;
  lastValidBlockHeight?: number;
  expiresAt?: string;
  blockhashExpiryHintSec?: number;
  [key: string]: unknown;
}

/** Step 2. `wallet` must match the one quoted. */
export function buildOrder(input: {
  quoteId: string;
  wallet: string;
  userId?: string;
  maxSlippageBps?: number;
}): Promise<OrderBuild> {
  return pantaFetch<OrderBuild>("/primaryorderbuild/", { method: "POST", body: input });
}

/** Step 3. Idempotent for the same orderId + signature. */
export function submitOrder(orderId: string, signature: string): Promise<Record<string, unknown>> {
  return pantaFetch("/primaryordersubmit/", { method: "POST", body: { orderId, signature } });
}

/** Optional re-check. Panta's verification is fail-closed -- TX_NOT_FOUND,
 * TX_FAILED, TX_MISMATCH, TX_FEE_MISMATCH -- so a clean result here is
 * evidence rather than a receipt. Note it takes the orderId too, not just the
 * signature. */
export function verifyOrder(
  orderId: string,
  signature: string,
): Promise<Record<string, unknown>> {
  return pantaFetch("/primaryorderverify/", { method: "POST", body: { orderId, signature } });
}

/** Trade attribution. Accepts primary buys and win claims only; reporting a
 * creator-fee claim here fails with TX_MISMATCH by design. */
export function reportTrade(input: {
  signature: string;
  kind: "buy" | "claim";
  [key: string]: unknown;
}): Promise<Record<string, unknown>> {
  return pantaFetch("/trades/", { method: "POST", body: input });
}

// ---------------------------------------------------------------- claims

/** UNVERIFIED PATHS. The docs list these actions but never print their cURL,
 * and unlike the create/buy families there is no obvious naming pattern to
 * infer from. Do not assume these work; confirm against
 * https://docs.panta.market/api-reference/claims/build before relying on them,
 * or exercise one with a free call first. */

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
