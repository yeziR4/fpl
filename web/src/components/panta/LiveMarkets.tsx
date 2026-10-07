"use client";

/**
 * The live market list: real Panta markets, fetched in the browser.
 *
 * Everything here is a client concern on purpose. The site is a static export
 * (next.config.ts), so a Server Component would fetch once at build time and
 * serve a stale price forever after. See lib/panta.ts.
 *
 * The empty states are deliberately distinct, because "Panta has no primary
 * markets" and "our service is down" look identical in a UI that only knows
 * how to render a list:
 *
 *   loading   -> skeleton, not a spinner over an empty grid
 *   error     -> says the service is unreachable, and why
 *   empty     -> says the catalog is genuinely empty, and that this is normal
 *
 * That last one is not hypothetical. Panta's live catalog contained zero
 * primary markets until this project created one, and a UI that renders that
 * as a blank screen teaches a visitor the wrong thing.
 */

import { useEffect, useState } from "react";
import {
  PantaUnavailable,
  fetchMarkets,
  fromUnixSeconds,
  isPrimary,
  usdc,
  yesPercent,
  yesPrice,
  noPrice,
  type MarketsPayload,
  type PantaMarket,
} from "@/lib/panta";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: MarketsPayload };

export function LiveMarkets() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchMarkets(controller.signal)
      .then((data) => setState({ kind: "ready", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message:
            error instanceof PantaUnavailable
              ? error.message
              : "Could not reach the market service.",
        });
      });
    return () => controller.abort();
  }, []);

  const live = state.kind === "ready" ? state.data.primary : [];

  return (
    <section id="markets" className="border-t border-foreground/10 bg-background">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:px-10">
        <div className="mb-10 flex flex-col gap-3">
          <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">
            On Solana mainnet
          </span>
          <h2 className="font-display text-4xl font-black uppercase leading-[0.98] text-foreground sm:text-5xl">
            Live markets
          </h2>
          <p className="max-w-xl text-[15px] leading-relaxed text-foreground/60">
            Real prediction markets on Panta, created by this project and tradable
            by anyone. Prices move with the crowd, and the market resolves against
            the official FPL data once the gameweek is final.
          </p>
        </div>

        {state.kind === "loading" && <SkeletonGrid />}

        {state.kind === "error" && (
          <Notice
            title="Market service unreachable"
            body={state.message}
            hint="Live prices are read through our own service, which holds the Panta API key. It is not running or not configured for this deployment."
          />
        )}

        {state.kind === "ready" && live.length === 0 && (
          <Notice
            title="No primary markets right now"
            body={`Panta's catalog is reachable — it reports ${state.data.secondaryCount} secondary market${
              state.data.secondaryCount === 1 ? "" : "s"
            } and no primary ones.`}
            hint="Primary is the phase this project creates and trades in. An empty primary list is the normal state of the catalog, not a fault."
          />
        )}

        {state.kind === "ready" && live.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {live.map((market) => (
                <MarketCard key={market.marketId} market={market} />
              ))}
            </div>
            <p className="mt-6 text-[12.5px] text-foreground/40">
              {state.data.primaryCount} primary market
              {state.data.primaryCount === 1 ? "" : "s"} live ·{" "}
              {state.data.secondaryCount} in secondary trading
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function MarketCard({ market }: { market: PantaMarket }) {
  const percent = yesPercent(market);
  const yes = yesPrice(market);
  const no = noPrice(market);
  const photo = market.images?.[0];
  const end = fromUnixSeconds(market.endTime);

  return (
    <a
      href={`/market?id=${encodeURIComponent(market.marketId)}`}
      className="flex flex-col overflow-hidden rounded-lg border border-foreground/12 bg-white/[0.02] transition-colors hover:border-accent/50"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-accent-dim">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- market images come
          // from arbitrary third-party hosts, and a static export has no image
          // optimizer to route them through anyway (see next.config.ts).
          <img
            src={photo}
            alt={market.title ?? "Market"}
            className="h-full w-full object-cover object-top"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] uppercase tracking-[0.1em] text-foreground/30">
            No image
          </div>
        )}
        <div className="absolute left-2.5 top-2.5 flex gap-1.5">
          {isPrimary(market) && (
            <span className="rounded bg-background/85 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-accent">
              Primary
            </span>
          )}
          {market.marketType && (
            <span className="rounded bg-background/85 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-foreground/60">
              {market.marketType}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="text-[15px] font-semibold leading-snug text-foreground">
          {market.title ?? market.question ?? "Untitled market"}
        </h3>

        {percent !== null && <PriceBar percent={percent} />}

        <div className="grid grid-cols-2 gap-2">
          <Side label="YES" price={yes} tone="accent" />
          <Side label="NO" price={no} tone="muted" />
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-foreground/10 pt-2.5 text-[11.5px] text-foreground/45">
          <span>{usdc(market.volumeUsdc) ?? "—"} volume</span>
          {end && <Countdown end={end} />}
        </div>
      </div>
    </a>
  );
}

function Side({ label, price, tone }: { label: string; price: number | null; tone: "accent" | "muted" }) {
  return (
    <div className="flex flex-col rounded-md border border-foreground/10 bg-white/[0.03] px-2.5 py-2">
      <span
        className={`text-[10px] font-bold uppercase tracking-[0.09em] ${
          tone === "accent" ? "text-accent" : "text-foreground/45"
        }`}
      >
        {label}
      </span>
      <span className="font-display text-lg font-black leading-tight text-foreground tabular-nums">
        {price === null ? "—" : price.toFixed(3)}
      </span>
    </div>
  );
}

/** The YES/NO split as a single bar — the one thing that reads instantly. */
function PriceBar({ percent }: { percent: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <div className="bg-accent transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-foreground/50">
        <span className="font-semibold text-accent">{percent}% YES</span>
        <span>{100 - percent}% NO</span>
      </div>
    </div>
  );
}

/**
 * Trading stops at the market's endTime (Panta: "All trading stops here"), so
 * this counts down to that, not to the fixture kickoff a visitor might expect.
 * A client timer because it has to tick, and because a build-time countdown
 * would be frozen at whatever moment the site was last deployed.
 */
function Countdown({ end }: { end: Date }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) {
    // Render nothing on the server pass and the first client paint, so the
    // markup matches and React does not report a hydration mismatch.
    return <span className="tabular-nums text-foreground/30">—</span>;
  }

  const ms = end.getTime() - now;
  if (ms <= 0) return <span className="font-semibold text-foreground/45">Trading closed</span>;

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const label =
    days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return (
    <span className="tabular-nums">
      Closes in <span className="font-semibold text-foreground/70">{label}</span>
    </span>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex animate-pulse flex-col overflow-hidden rounded-lg border border-foreground/10"
        >
          <div className="aspect-[4/3] w-full bg-foreground/[0.04]" />
          <div className="flex flex-col gap-3 p-4">
            <div className="h-4 w-3/4 rounded bg-foreground/[0.06]" />
            <div className="h-1.5 w-full rounded-full bg-foreground/[0.06]" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-12 rounded-md bg-foreground/[0.04]" />
              <div className="h-12 rounded-md bg-foreground/[0.04]" />
            </div>
          </div>
        </div>
      ))}
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
      {hint && <p className="max-w-xl text-[12.5px] leading-relaxed text-foreground/35">{hint}</p>}
    </div>
  );
}
