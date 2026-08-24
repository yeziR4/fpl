import Image from "next/image";
import { positionLabel, type Player } from "@/lib/fpl";

export interface MarketPlayer {
  player: Player;
  badgeUrl: string;
}

interface MarketsSectionProps {
  players: MarketPlayer[];
}

export function MarketsSection({ players }: MarketsSectionProps) {
  return (
    <section id="markets" className="border-t border-foreground/10 bg-background">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:px-10">
        <div className="mb-10 flex flex-col gap-3">
          <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">
            This gameweek
          </span>
          <h2 className="font-display text-4xl font-black uppercase leading-[0.98] text-foreground sm:text-5xl">
            Open markets
          </h2>
          <p className="max-w-lg text-[15px] leading-relaxed text-foreground/60">
            Two markets per player, settled the moment their match finishes: will they
            score 5+ points, and will they score 10+.
          </p>
        </div>

        {players.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {players.map(({ player, badgeUrl }) => (
              <MarketCard key={player.id} player={player} badgeUrl={badgeUrl} />
            ))}
          </div>
        ) : (
          <MarketsUnavailable />
        )}
      </div>
    </section>
  );
}

function MarketCard({ player, badgeUrl }: MarketPlayer) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-foreground/12 bg-white/[0.02] transition-colors hover:border-accent/50">
      <div className="relative aspect-[4/3] w-full bg-accent-dim">
        <Image
          src={player.photoUrl}
          alt={player.webName}
          fill
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="object-cover object-top"
          unoptimized
        />
        <div className="absolute left-2.5 top-2.5 rounded bg-background/80 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-accent">
          {positionLabel(player.elementType)}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <div className="flex items-center gap-2">
          <div className="relative h-4.5 w-4.5 shrink-0 overflow-hidden rounded-full bg-foreground/10">
            <Image src={badgeUrl} alt="" fill sizes="18px" className="object-contain p-0.5" unoptimized />
          </div>
          <span className="truncate text-[14px] font-semibold text-foreground">{player.webName}</span>
        </div>
        <span className="text-[12.5px] text-foreground/50">£{player.priceMillions.toFixed(1)}m</span>

        <div className="mt-1 flex flex-col gap-1.5">
          <MarketButton label="Over 5 pts" />
          <MarketButton label="Over 10 pts" />
        </div>
        <span className="text-center text-[10.5px] text-foreground/35">Pool opens at kickoff</span>
      </div>
    </div>
  );
}

function MarketButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="rounded border border-accent/35 bg-accent/[0.06] px-3 py-2 text-[12.5px] font-medium text-foreground/85 transition-colors hover:border-accent hover:bg-accent/15"
    >
      {label}
    </button>
  );
}

function MarketsUnavailable() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-foreground/15 px-6 py-16 text-center">
      <span className="font-display text-lg font-extrabold uppercase tracking-[0.04em] text-foreground/70">
        Markets unavailable
      </span>
      <p className="max-w-sm text-[13.5px] leading-relaxed text-foreground/45">
        Couldn&rsquo;t reach the FPL data source. Markets will appear here once it&rsquo;s
        reachable again.
      </p>
    </div>
  );
}
