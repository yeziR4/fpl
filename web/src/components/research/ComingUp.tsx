import pipeline from "@/data/pipeline.json";

/**
 * The next markets we intend to list.
 *
 * Replaces a much longer section that scored all 36 candidates and explained the
 * royalty curve at length. That version was accurate and read as padding: a
 * reader wants to know what is coming, not how the ranking works. Ten rows, four
 * columns, one sentence.
 *
 * The ranking still matters internally -- it is why the line is 8+ and not 10+ --
 * but it belongs in the commit history, not on the front page.
 */

interface Candidate {
  player: string;
  team: string;
  position: string;
  line: number;
  ownershipPercent: number;
  noTiltPercent: number;
  royaltyBand: string;
  photoUrl: string | null;
}

const TOP_N = 10;

export function ComingUp() {
  const candidates = (pipeline.candidates ?? []) as Candidate[];
  if (candidates.length === 0) return null;

  const top = candidates.slice(0, TOP_N);

  return (
    <section id="coming-up" className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-6 py-16 sm:px-10">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">
          Next up
        </span>
        <h2 className="mt-3 font-display text-3xl font-black uppercase leading-[1.02] text-foreground sm:text-4xl">
          Markets we are listing next
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-foreground/60">
          Each line is chosen so the crowd splits rather than agrees — a market everyone calls right
          pays the creator nothing, and a market nobody has a view on never trades.
        </p>

        <div className="mt-8 overflow-hidden rounded-lg border border-hairline bg-surface">
          <div className="grid grid-cols-[2fr_0.7fr_0.8fr_1fr] gap-3 border-b border-hairline px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/40">
            <span>Player</span>
            <span className="text-right">Line</span>
            <span className="text-right">Owned</span>
            <span className="text-right">Splits the crowd</span>
          </div>
          <div className="divide-y divide-hairline">
            {top.map((c, i) => (
              <div
                key={`${c.player}-${c.position}-${c.line}`}
                className="grid grid-cols-[2fr_0.7fr_0.8fr_1fr] items-center gap-3 px-4 py-2.5 hover:bg-surface-strong"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-4 shrink-0 text-[11px] tnum text-foreground/25">{i + 1}</span>
                  {c.photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- third-party
                    // CDN, and a static export has no image optimizer (next.config.ts).
                    <img
                      src={c.photoUrl}
                      alt=""
                      loading="lazy"
                      className="h-8 w-8 shrink-0 rounded-full bg-accent-dim object-cover object-top"
                    />
                  )}
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13.5px] font-semibold text-foreground">
                      {c.player}
                    </span>
                    <span className="text-[10.5px] text-foreground/40">
                      {c.team} · {c.position}
                    </span>
                  </div>
                </div>
                <span className="tnum text-right text-[13px] font-semibold text-foreground">
                  {c.line}+
                </span>
                <span className="tnum text-right text-[13px] text-foreground/60">
                  {c.ownershipPercent}%
                </span>
                <span className="flex items-center justify-end gap-2">
                  <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-foreground/10 sm:block">
                    <span
                      className="block h-full bg-accent"
                      style={{ width: `${Math.min(100, c.noTiltPercent)}%` }}
                    />
                  </span>
                  <span
                    className={`tnum text-[12px] ${
                      c.royaltyBand === "20% full" ? "text-accent" : "text-foreground/40"
                    }`}
                  >
                    {c.royaltyBand}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
