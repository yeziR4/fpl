"use client";

/**
 * One market, in full: prices, the creator's own book, and the resolution terms.
 *
 * Why a query parameter and not /market/[id]: this site is a static export, and
 * Next requires generateStaticParams() for dynamic routes in that mode. Market
 * ids are created at runtime on Solana, so the set is unknowable at build time
 * and any [id] route would 404 for every real market. ?id= needs no build-time
 * knowledge. (See node_modules/next/dist/docs/01-app/02-guides/static-exports.md.)
 *
 * The id is read from window.location in an effect rather than with
 * useSearchParams(), which in this Next version wants a Suspense boundary
 * around it during static rendering. Reading location avoids that entirely and
 * costs nothing here, because the market itself is fetched client-side anyway.
 */

import { useEffect, useState } from "react";
import {
  PantaUnavailable,
  fetchMarket,
  fetchPositions,
  fromUnixSeconds,
  usdc,
  yesPercent,
  yesPrice,
  noPrice,
  type PantaMarket,
  type PositionsResponse,
} from "@/lib/panta";

/** The wallet that created and seeded our markets. Public on-chain. */
const CREATOR_WALLET = "65YstDRZo7KXqtwFifypnFNiSKh2VGGh8bXNCSqNcyyM";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; market: PantaMarket };

export function MarketDetail() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [marketId, setMarketId] = useState<string | null>(null);
  const [book, setBook] = useState<PositionsResponse | null>(null);

  useEffect(() => {
    setMarketId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  useEffect(() => {
    if (!marketId) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchMarket(marketId, controller.signal)
      .then((market) => setState({ kind: "ready", market }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message:
            error instanceof PantaUnavailable ? error.message : "Could not load this market.",
        });
      });
    fetchPositions(CREATOR_WALLET, controller.signal)
      .then(setBook)
      .catch(() => setBook(null));
    return () => controller.abort();
  }, [marketId]);

  if (marketId === null) return <Frame><Loading /></Frame>;
  if (!marketId) {
    return (
      <Frame>
        <Notice
          title="No market selected"
          body="This page needs a market id, for example /market?id=C86nbpSX4ntRWvN4HMrdnhzHjHTtLooNtnw6k7hnmx1F."
        />
      </Frame>
    );
  }
  if (state.kind === "loading") return <Frame><Loading /></Frame>;
  if (state.kind === "error") {
    return (
      <Frame>
        <Notice
          title="Market unavailable"
          body={state.message}
          hint={`Market id: ${marketId}`}
        />
      </Frame>
    );
  }

  const { market } = state;
  const percent = yesPercent(market);
  const mine = book?.positions?.filter((p) => p.marketId === marketId) ?? [];

  return (
    <Frame>
      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="flex flex-1 flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">{market.phase ?? "unknown phase"}</Badge>
              {market.marketType && <Badge>{market.marketType}</Badge>}
              {market.category && <Badge>{market.category}</Badge>}
              {market.resolved && <Badge tone="accent">resolved</Badge>}
            </div>
            <h1 className="font-display text-3xl font-black uppercase leading-[1.02] text-foreground sm:text-4xl">
              {market.title ?? market.question ?? "Untitled market"}
            </h1>
            {market.description && (
              <p className="max-w-2xl text-[15px] leading-relaxed text-foreground/60">
                {market.description}
              </p>
            )}
          </div>

          <PricePanel market={market} percent={percent} />

          <Panel title="Resolution criteria">
            <p className="text-[14px] leading-relaxed text-foreground/70">
              {market.resolutionCriteria ??
                "Panta resolves this market against the sources below once the event has finished."}
            </p>
            {Array.isArray(market.sourcesOfTruth) && market.sourcesOfTruth.length > 0 && (
              <div className="mt-3 flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/40">
                  Sources
                </span>
                {market.sourcesOfTruth.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-[12.5px] text-accent/80 underline-offset-2 hover:underline"
                  >
                    {url}
                  </a>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="The creator's book">
            <p className="text-[13.5px] leading-relaxed text-foreground/55">
              Creating a market costs 20 USDC, of which 5 USDC seeds liquidity on both
              sides. That seed is the creator&rsquo;s own money and it is visible on chain —
              so this market started with real capital at risk on each outcome, not just
              a question in a database.
            </p>
            {mine.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {mine.map((p) => (
                  <div
                    key={`${p.marketId}-${p.side}`}
                    className="flex flex-col rounded-md border border-foreground/10 bg-white/[0.03] px-3 py-2"
                  >
                    <span
                      className={`text-[10px] font-bold uppercase tracking-[0.09em] ${
                        p.side === "yes" ? "text-accent" : "text-foreground/45"
                      }`}
                    >
                      {p.side ?? "?"} shares
                    </span>
                    <span className="font-display text-lg font-black text-foreground tabular-nums">
                      {p.shares ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-[12.5px] text-foreground/35">
                No positions readable for this market right now.
              </p>
            )}
            {book?.summary?.primaryContributedUsdc && (
              <p className="mt-3 text-[12px] text-foreground/35">
                {usdc(book.summary.primaryContributedUsdc)} contributed in primary trading by
                this wallet.
              </p>
            )}
          </Panel>
        </div>

        <aside className="flex w-full flex-col gap-4 lg:w-80">
          {market.images?.[0] && (
            <div className="overflow-hidden rounded-lg border border-foreground/12 bg-accent-dim">
              {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party hosts, and a static export has no image optimizer (see next.config.ts). */}
              <img
                src={market.images[0]}
                alt={market.title ?? "Market"}
                className="aspect-square w-full object-cover object-top"
              />
            </div>
          )}

          <Panel title="Schedule">
            <Row label="Created" value={format(market.createdAt)} />
            <Row label="Trading opens" value={format(market.startTime)} />
            <Row label="Trading stops" value={format(market.endTime)} />
            <Row label="Resolves" value={format(market.resolutionTime)} />
            {market.region && <Row label="Region" value={String(market.region)} />}
          </Panel>

          <Panel title="Market id">
            <code className="block break-all text-[11px] leading-relaxed text-foreground/45">
              {market.marketId}
            </code>
            <a
              href={`https://panta.market/markets/${market.marketId}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-[12.5px] font-semibold text-accent underline-offset-2 hover:underline"
            >
              Open on Panta.Market →
            </a>
          </Panel>
        </aside>
      </div>
    </Frame>
  );
}

function PricePanel({ market, percent }: { market: PantaMarket; percent: number | null }) {
  const yes = yesPrice(market);
  const no = noPrice(market);

  return (
    <Panel title="Primary trading">
      {percent !== null ? (
        <>
          <div className="flex h-2 overflow-hidden rounded-full bg-foreground/10">
            <div className="bg-accent transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[12px] tabular-nums">
            <span className="font-semibold text-accent">{percent}% YES</span>
            <span className="text-foreground/50">{100 - percent}% NO</span>
          </div>
        </>
      ) : (
        <p className="text-[13px] text-foreground/45">
          This market has no quoted price yet. Panta prices a fresh market at 0.50
          once the first order is quoted, which can lag the market&rsquo;s own creation.
        </p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric label="YES" value={yes === null ? "—" : yes.toFixed(4)} tone="accent" />
        <Metric label="NO" value={no === null ? "—" : no.toFixed(4)} />
        <Metric label="Volume" value={usdc(market.volumeUsdc) ?? "—"} />
      </div>
    </Panel>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-16 sm:px-10">{children}</main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-foreground/12 bg-white/[0.02] p-5">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/40">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "accent" }) {
  return (
    <div className="flex flex-col rounded-md border border-foreground/10 bg-white/[0.03] px-3 py-2">
      <span
        className={`text-[10px] font-bold uppercase tracking-[0.09em] ${
          tone === "accent" ? "text-accent" : "text-foreground/45"
        }`}
      >
        {label}
      </span>
      <span className="font-display text-lg font-black leading-tight text-foreground tabular-nums">
        {value}
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-foreground/[0.07] py-1.5 last:border-0">
      <span className="text-[12px] text-foreground/45">{label}</span>
      <span className="text-[12.5px] font-medium text-foreground/75 tabular-nums">{value}</span>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "accent" }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] ${
        tone === "accent"
          ? "bg-accent/15 text-accent"
          : "bg-foreground/[0.06] text-foreground/55"
      }`}
    >
      {children}
    </span>
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6">
      <div className="h-8 w-2/3 rounded bg-foreground/[0.06]" />
      <div className="h-40 rounded-lg bg-foreground/[0.04]" />
      <div className="h-28 rounded-lg bg-foreground/[0.04]" />
    </div>
  );
}

function Notice({ title, body, hint }: { title: string; body: string; hint?: string }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-foreground/15 px-6 py-10">
      <span className="font-display text-lg font-extrabold uppercase tracking-[0.04em] text-foreground/80">
        {title}
      </span>
      <p className="max-w-xl text-[13.5px] leading-relaxed text-foreground/55">{body}</p>
      {hint && <p className="max-w-xl text-[12px] text-foreground/30">{hint}</p>}
    </div>
  );
}

/** Accepts unix seconds (Panta's unit) or an ISO string, and never throws. */
function format(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const d =
    typeof value === "number"
      ? fromUnixSeconds(value)
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
