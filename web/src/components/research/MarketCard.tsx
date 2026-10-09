import type { MarketRef } from "@/lib/study";

/**
 * One market in the study, with a link out to where it actually trades.
 *
 * No price, deliberately. A price copied into a static build is wrong minutes
 * later and there is no honest way to label it as "live" -- so the card says what
 * it does know (who it settles on, how many study positions are in it) and sends
 * the reader to Panta for the number that moves.
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
  return (
    <a
      href={market.pantaUrl}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col rounded-lg border border-hairline bg-surface p-4 transition-colors hover:border-accent/50"
    >
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

      <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3 text-[11.5px]">
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
        <span className="font-semibold text-accent">Trade on Panta →</span>
      </div>
    </a>
  );
}
