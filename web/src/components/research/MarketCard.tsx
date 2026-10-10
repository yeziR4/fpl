import type { MarketRef } from "@/lib/study";

/**
 * One market in the study: what it asks, whether it has been decided, and where
 * it actually trades.
 *
 * No live price, deliberately. A price copied into a static build is wrong
 * minutes later and there is no honest way to label it "live" -- the card says
 * what it does know and sends the reader to Panta for the number that moves.
 *
 * The RESULT is a different thing and does belong here. It is a fact about the
 * past: this player scored this many points, and the line did or did not clear.
 * That does not go stale, and it is the whole point of the study.
 *
 * `decided` and `final` are shown as different states on purpose. A market can
 * be decided -- Saka on 2 cannot reach 7 even with maximum bonus -- while FPL
 * has still not confirmed bonus for the gameweek. Presenting the second as the
 * first is how a page ends up quietly wrong an hour later.
 */
export function StudyMarketCard({
  market,
  positions,
  committed,
}: {
  market: MarketRef;
  positions: number;
  committed: number;
}) {
  const resolved = market.outcome !== null && market.decided;
  const tone =
    market.outcome === "yes" ? "text-accent" : market.outcome === "no" ? "text-rose-400" : "";

  return (
    <div className="flex flex-col rounded-lg border border-hairline bg-surface p-4 transition-colors hover:border-accent/50">
      <a href={market.pantaUrl} target="_blank" rel="noreferrer" className="flex flex-col">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-xl font-black uppercase text-foreground">
            {market.player} {market.line}+
          </span>
          <span className="shrink-0 rounded bg-surface-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-foreground/50">
            {market.position}
          </span>
        </div>

        <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-foreground/55">
          {market.title}
        </p>
      </a>

      {/* The result, when the player has actually played. */}
      {market.points !== null && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface-strong px-3 py-2">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className={`font-display text-lg font-black uppercase tnum ${tone}`}>
              {resolved ? `Resolved ${market.outcome}` : "Not decided"}
            </span>
            <span className="text-[11.5px] text-foreground/50">
              scored <span className="tnum font-semibold text-foreground/75">{market.points}</span>{" "}
              vs line {market.line}
            </span>
          </span>
          {resolved && !market.final && (
            <span
              className="shrink-0 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-foreground/35"
              title="Bonus cannot change this outcome, but FPL has not confirmed bonus for the gameweek yet."
            >
              bonus provisional
            </span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-hairline pt-3 text-[11.5px]">
        <span className="text-foreground/45">
          {positions === 0 ? (
            "no study positions yet"
          ) : (
            <>
              {positions} position{positions === 1 ? "" : "s"} ·{" "}
              <span className="tnum text-foreground/65">${committed.toFixed(2)}</span>
            </>
          )}
        </span>
        <a
          href={market.pantaUrl}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-accent hover:underline"
        >
          Trade on Panta →
        </a>
      </div>
    </div>
  );
}
