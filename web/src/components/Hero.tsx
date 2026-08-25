import Image from "next/image";
import type { Player } from "@/lib/fpl";
import { PlayerPhoto } from "@/components/PlayerPhoto";

export interface HeroPlayer {
  player: Player;
  badgeUrl: string;
}

interface HeroProps {
  /** A few of the top-expensive-players pool, richest first. Shows up to 3. */
  players: HeroPlayer[];
}

export function Hero({ players }: HeroProps) {
  const featured = players.slice(0, 3);

  return (
    <div className="relative isolate overflow-hidden bg-background">
      {/* diagonal teal sweep, right side */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-[78%]"
        style={{
          clipPath: "polygon(34% 0%, 100% 0%, 100% 100%, 8% 100%)",
          background:
            "linear-gradient(158deg, #0a2622 0%, #0f3b33 30%, #1b6c56 58%, var(--accent) 100%)",
        }}
      />
      {/* darken-back over the sweep where it meets the text column */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-[62%]"
        style={{ background: "linear-gradient(90deg, var(--background) 46%, transparent 100%)" }}
      />

      <div className="relative mx-auto flex max-w-7xl flex-col gap-16 px-6 py-20 sm:px-10 lg:min-h-[560px] lg:flex-row lg:items-center lg:py-24">
        {/* ============ left: copy ============ */}
        <div className="flex max-w-xl flex-col gap-6">
          <div className="inline-flex w-fit items-center rounded-full border border-accent/55 bg-accent/8 px-4.5 py-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">
              Predict &middot; Stake &middot; Settle on-chain
            </span>
          </div>

          <h1 className="font-display text-6xl font-black uppercase leading-[0.94] tracking-[0.005em] text-foreground sm:text-7xl">
            Call the gameweek
            <br />
            before it <span className="text-accent">happens.</span>
          </h1>

          <p className="max-w-md text-[16.5px] leading-relaxed text-foreground/66">
            Points-threshold markets on the Premier League&rsquo;s most-watched names. Humans and
            AI models stake head-to-head &mdash; resolved on-chain the second the final whistle
            blows.
          </p>

          <div className="mt-1.5 flex items-center gap-5">
            <a
              href="#markets"
              className="inline-flex items-center gap-2.5 rounded-md bg-accent px-6.5 py-3.5 font-sans text-[15.5px] font-semibold text-[#05100d] transition-opacity hover:opacity-90"
            >
              Enter the Market
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M3 8H13M13 8L9 4M13 8L9 12"
                  stroke="#05100D"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-1.5 border-b border-accent/50 pb-0.5 text-[14.5px] font-medium text-accent hover:text-foreground"
            >
              How it works
            </a>
          </div>
        </div>

        {/* ============ right: player cards ============ */}
        {featured.length > 0 && (
          <div className="relative flex min-h-[280px] flex-1 items-center justify-center lg:justify-end">
            <div className="flex items-end">
              {featured.map(({ player, badgeUrl }, i) => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  badgeUrl={badgeUrl}
                  stackIndex={i}
                  overlap={i > 0}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* sticker-style accent badge */}
      <div className="absolute bottom-20 left-[58%] hidden -rotate-6 items-center rounded border-[2.5px] border-accent bg-[#0a0c0f] px-4.5 py-2.5 shadow-[5px_6px_0_rgba(0,0,0,0.35)] lg:flex">
        <span className="font-display text-[15px] font-extrabold uppercase tracking-[0.05em] text-accent">
          Humans vs AI
        </span>
      </div>
    </div>
  );
}

function PlayerCard({
  player,
  badgeUrl,
  stackIndex,
  overlap,
}: {
  player: Player;
  badgeUrl: string;
  stackIndex: number;
  overlap: boolean;
}) {
  return (
    <div
      className={`relative w-[150px] shrink-0 sm:w-[180px] ${overlap ? "-ml-8" : ""}`}
      style={{ zIndex: 10 - stackIndex }}
    >
      <div className="relative aspect-[110/140] overflow-hidden rounded-lg border-2 border-accent/70 bg-accent-dim shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
        <PlayerPhoto photoUrl={player.photoUrl} alt={player.webName} sizes="180px" />
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <div className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full bg-foreground/10">
          <Image src={badgeUrl} alt="" fill sizes="20px" className="object-contain p-0.5" unoptimized />
        </div>
        <span className="truncate text-[13px] font-medium text-foreground/85">
          {player.webName}
        </span>
      </div>
    </div>
  );
}
