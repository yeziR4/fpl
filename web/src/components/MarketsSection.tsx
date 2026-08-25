import Image from "next/image";
import { positionLabel, type Player } from "@/lib/fpl";
import { PlayerPhoto } from "@/components/PlayerPhoto";
import { StatCountUp } from "@/components/StatCountUp";

export interface MarketOpponent {
  badgeUrl: string;
  shortName: string;
  isHome: boolean;
}

export interface MarketPlayer {
  player: Player;
  badgeUrl: string;
  /** null: no fixture this gameweek (blank/double gameweek) -- shown honestly, not guessed at. */
  opponent: MarketOpponent | null;
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
            {players.map(({ player, badgeUrl, opponent }) => (
              <MarketCard key={player.id} player={player} badgeUrl={badgeUrl} opponent={opponent} />
            ))}
          </div>
        ) : (
          <MarketsUnavailable />
        )}
      </div>
    </section>
  );
}

function MarketCard({ player, badgeUrl, opponent }: MarketPlayer) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-foreground/12 bg-white/[0.02] transition-colors hover:border-accent/50">
      <div className="relative aspect-[4/3] w-full bg-accent-dim">
        <PlayerPhoto
          photoUrl={player.photoUrl}
          alt={player.webName}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="object-top"
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
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] text-foreground/50">£{player.priceMillions.toFixed(1)}m</span>
          {opponent ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11.5px] font-medium text-foreground/45">
                {opponent.isHome ? "vs" : "@"}
              </span>
              <div className="relative h-4 w-4 shrink-0 overflow-hidden rounded-full bg-foreground/10">
                <Image
                  src={opponent.badgeUrl}
                  alt={opponent.shortName}
                  fill
                  sizes="16px"
                  className="object-contain p-0.5"
                  unoptimized
                />
              </div>
              <span className="text-[11.5px] font-semibold text-foreground/70">
                {opponent.shortName}
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-foreground/35">No fixture</span>
          )}
        </div>

        <StatStrip player={player} />

        <div className="mt-1 flex flex-col gap-2">
          <MarketRow label="Over 5 pts" />
          <MarketRow label="Over 10 pts" />
        </div>
        <span className="text-center text-[10.5px] text-foreground/35">Pool opens at kickoff</span>
      </div>
    </div>
  );
}

/**
 * Season-to-date PTS / G / A, rolling up from 0 the moment the card
 * scrolls into view -- the broadcast-graphic touch requested, built on
 * real bootstrap-static stats rather than licensed match footage.
 */
function StatStrip({ player }: { player: Player }) {
  return (
    <div className="flex items-stretch rounded-md border border-foreground/10 bg-white/[0.03]">
      <Stat label="Pts" value={player.totalPoints} />
      <div className="w-px shrink-0 bg-foreground/10" />
      <Stat label="Goals" value={player.goalsScored} />
      <div className="w-px shrink-0 bg-foreground/10" />
      <Stat label="Assists" value={player.assists} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-0.5 py-1.5">
      <span className="font-display text-lg font-black leading-none text-accent">
        <StatCountUp value={value} />
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-[0.09em] text-foreground/40">
        {label}
      </span>
    </div>
  );
}

function MarketRow({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-foreground/50">{label}</span>
      <div className="grid grid-cols-2 gap-1.5">
        <MarketButton label="Yes" variant="yes" />
        <MarketButton label="No" variant="no" />
      </div>
    </div>
  );
}

function MarketButton({ label, variant }: { label: string; variant: "yes" | "no" }) {
  const isYes = variant === "yes";
  return (
    <button
      type="button"
      className={
        isYes
          ? "rounded border border-accent bg-accent px-2 py-1.5 text-[12px] font-semibold text-[#05100d] transition-opacity hover:opacity-90"
          : "rounded border border-foreground/25 bg-transparent px-2 py-1.5 text-[12px] font-medium text-foreground/70 transition-colors hover:border-foreground/45 hover:text-foreground"
      }
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
