import Image from "next/image";
import { modelAnchorId } from "@/lib/leaderboard";
import { formatUsd } from "@/lib/vara/price";
import { PlayerPhoto } from "@/components/PlayerPhoto";

/**
 * Every model's full bet history, across every gameweek that has a
 * saved picks file -- not just the latest one. Originally this only
 * showed the current gameweek; requested directly after that shipped:
 * "no i am saying their previous bets not only the future [one]" --
 * clicking a model now has to actually show what it did before, not
 * just what it's about to do.
 *
 * Each pick now carries a real bet record: a VARA stake, and the
 * potential return from this system's own odds (see "Market maker:
 * rank-based odds", `oddsmaker.py`). Simulated, not real money (these
 * five wallets hold nothing and never stake for real, see
 * docs/architecture.md's "AI agent picks & leaderboard" section), but
 * every number is real and computed, not invented, which is the whole
 * point of showing it at all. Shown in dollars throughout, VARA kept
 * purely as the backend unit -- requested directly: "the vara
 * mechanism should be at the backend... the only time we will need
 * vara is when they want to pay or get paid" -- nothing here pays or
 * gets paid, it's simulated.
 *
 * Each pick shows a face and a match, not just a name -- a player
 * photo and their actual opponent for THAT specific gameweek (see
 * lib/fpl.ts's fixturesForTeamInGw), resolved per-gameweek since a
 * player's opponent obviously isn't the same every week.
 */

export interface PickPlayerInfo {
  webName: string;
  photoUrl: string | null;
  opponent: { badgeUrl: string; shortName: string; isHome: boolean } | null;
}

export interface HistoryPick {
  playerId: number;
  threshold: number;
  side: "yes" | "no";
  confidence: number | null;
  marketProbability: number | null;
  stakeVara: number | null;
  potentialReturnVara: number | null;
  /** Resolved for the specific gameweek this pick belongs to, not a
   * shared lookup -- an id not covered by that gameweek's own
   * bootstrap-static/fixtures snapshot falls back to a bare id and no
   * photo/opponent, never hides the pick. */
  player: PickPlayerInfo | null;
  /** Whether this specific pick actually won or lost -- from
   * data/leaderboard.json's per-pick outcome list (see lib/leaderboard.ts's
   * PickOutcome), the same resolve_points_threshold() verdict everything
   * else in this pipeline settles against. Null if this gameweek hasn't
   * been scored yet, or predates this field -- shown as neither a win
   * nor a loss, never guessed at. */
  outcome: "correct" | "wrong" | "pending" | null;
}

export interface ModelGwSummary {
  correct: number;
  wrong: number;
  pending: number;
  accuracy: number | null;
  stakedVara?: number;
  simulatedPnlVara?: number;
}

export interface ModelGwEntry {
  gw: number;
  error: string | null;
  picks: HistoryPick[];
  /** From data/leaderboard.json -- null if this gameweek hasn't been
   * scored yet (still in progress, or nothing finished to score
   * against), never a fabricated "pending" summary. */
  summary: ModelGwSummary | null;
}

export interface ModelHistory {
  slug: string;
  name: string;
  /** Newest gameweek first. */
  gameweeks: ModelGwEntry[];
}

interface ModelPicksSectionProps {
  models: ModelHistory[];
  /** Live VARA/USD rate this page fetched once, or null if that fetch
   * failed -- every dollar figure in this section is `stakeVara *
   * varaUsdPrice`, computed at render time rather than stored, so it
   * reflects today's rate, not necessarily the rate in effect the
   * moment a model's bet was sized. Falls back to showing the raw
   * VARA amount when null, never a fabricated dollar figure. */
  varaUsdPrice: number | null;
}

export function ModelPicksSection({ models, varaUsdPrice }: ModelPicksSectionProps) {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-5xl px-6 py-12 sm:px-10">
        <div className="mb-6 flex flex-col gap-2">
          <h2 className="font-display text-xl font-black uppercase tracking-[0.02em] text-foreground">
            Model bets
          </h2>
          <p className="max-w-lg text-[13px] leading-relaxed text-foreground/50">
            Every model&rsquo;s full bet history, gameweek by gameweek -- what it staked (sized
            off its own confidence) and what it stands to win at this system&rsquo;s own odds.
            Simulated — no real money moves here — but every number is real, computed from a real
            formula, not invented.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {models.map((model) => (
            <ModelHistoryCard key={model.slug} model={model} varaUsdPrice={varaUsdPrice} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** `stakeVara`/`returnVara` as a dollar string at `varaUsdPrice`, or
 * the raw VARA amount (never a fabricated dollar figure) if that
 * price is null. */
function money(varaAmount: number, varaUsdPrice: number | null): string {
  if (varaUsdPrice !== null) {
    const usd = formatUsd(varaAmount, varaUsdPrice);
    if (usd !== null) return usd;
  }
  return `${varaAmount} VARA`;
}

function formatAccuracy(accuracy: number | null): string {
  return accuracy === null ? "—" : `${Math.round(accuracy * 100)}%`;
}

function ModelHistoryCard({ model, varaUsdPrice }: { model: ModelHistory; varaUsdPrice: number | null }) {
  const totalStaked = model.gameweeks
    .flatMap((g) => g.picks)
    .reduce((sum, p) => sum + (p.stakeVara ?? 0), 0);
  const totalPicks = model.gameweeks.reduce((sum, g) => sum + g.picks.length, 0);

  return (
    // id + scroll-mt-24 is the landing target for LeaderboardTable's
    // "click a model, see their bets" links further up this same page
    // -- scroll-mt clears the sticky header (Header.tsx) so a jump
    // here doesn't land the card half-hidden underneath it.
    <div
      id={modelAnchorId(model.slug)}
      className="flex scroll-mt-24 flex-col rounded-lg border border-foreground/12 bg-white/[0.02] p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold text-foreground">{model.name}</span>
        <span className="text-[11px] text-foreground/35">
          {totalPicks} picks total
          {totalStaked > 0 && ` · ${money(totalStaked, varaUsdPrice)} staked`}
        </span>
      </div>

      {model.gameweeks.length === 0 ? (
        <p className="mt-3 text-[12px] text-foreground/40">No bets recorded yet.</p>
      ) : (
        <div className="mt-3 flex max-h-[32rem] flex-col gap-4 overflow-y-auto pr-1">
          {model.gameweeks.map((entry) => (
            <GwGroup key={entry.gw} entry={entry} varaUsdPrice={varaUsdPrice} />
          ))}
        </div>
      )}
    </div>
  );
}

function GwGroup({ entry, varaUsdPrice }: { entry: ModelGwEntry; varaUsdPrice: number | null }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-foreground/45">
          GW{entry.gw}
        </span>
        {entry.summary ? (
          <span className="text-[10.5px] text-foreground/40">
            {entry.summary.correct}/{entry.summary.correct + entry.summary.wrong} correct
            {entry.summary.pending > 0 ? ` (+${entry.summary.pending} pending)` : ""} ·{" "}
            {formatAccuracy(entry.summary.accuracy)}
          </span>
        ) : (
          <span className="text-[10.5px] text-foreground/35">not yet finished</span>
        )}
      </div>

      {entry.error ? (
        <p className="text-[12px] leading-relaxed text-foreground/45">
          Errored this gameweek — <span className="font-mono text-[11px]">{entry.error}</span>
        </p>
      ) : entry.picks.length === 0 ? (
        <p className="text-[12px] text-foreground/40">No bets this gameweek — saw no real edge anywhere.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {entry.picks.map((pick) => (
            <PickRow key={`${pick.playerId}-${pick.threshold}`} pick={pick} varaUsdPrice={varaUsdPrice} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** A small "got it right / got it wrong" marker per pick -- the whole
 * point of showing history at all: "show the one that they got
 * correct and the one that got it wrong", requested directly.
 * Renders nothing for a still-pending or never-scored pick (no
 * fabricated verdict) -- the GW group header already says "not yet
 * finished" for those, this only needs to flag the rarer case of one
 * pick still pending inside an otherwise-scored gameweek. */
function OutcomeBadge({ outcome }: { outcome: HistoryPick["outcome"] }) {
  if (outcome === "correct") {
    return (
      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.04em] text-accent">
        ✓ Correct
      </span>
    );
  }
  if (outcome === "wrong") {
    return (
      <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.04em] text-red-400">
        ✗ Wrong
      </span>
    );
  }
  if (outcome === "pending") {
    return (
      <span className="rounded bg-foreground/8 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.04em] text-foreground/40">
        Pending
      </span>
    );
  }
  return null;
}

function PickRow({ pick, varaUsdPrice }: { pick: HistoryPick; varaUsdPrice: number | null }) {
  const info = pick.player;
  return (
    <li className="flex items-center gap-2.5 border-b border-foreground/5 pb-2.5 text-[12px] last:border-b-0 last:pb-0">
      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-accent-dim">
        <PlayerPhoto
          photoUrl={info?.photoUrl ?? null}
          alt={info?.webName ?? `Player ${pick.playerId}`}
          sizes="36px"
          className="object-top"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-foreground/75">
            <span className="font-medium text-foreground/85">{info?.webName ?? `Player ${pick.playerId}`}</span>{" "}
            <span className="text-foreground/40">Over {pick.threshold}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className={`font-semibold ${pick.side === "yes" ? "text-accent" : "text-foreground/50"}`}>
              {pick.side === "yes" ? "Yes" : "No"}
            </span>
            <OutcomeBadge outcome={pick.outcome} />
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 text-[10.5px] text-foreground/40">
          <span className="flex items-center gap-1">
            {info?.opponent ? (
              <>
                <span className="relative h-3.5 w-3.5 shrink-0 overflow-hidden rounded-full bg-foreground/10">
                  <Image
                    src={info.opponent.badgeUrl}
                    alt={info.opponent.shortName}
                    fill
                    sizes="14px"
                    className="object-contain p-0.5"
                    unoptimized
                  />
                </span>
                {info.opponent.isHome ? "vs" : "@"} {info.opponent.shortName}
              </>
            ) : (
              "No fixture"
            )}
          </span>
          {pick.confidence !== null && <span>{Math.round(pick.confidence * 100)}% confident</span>}
        </div>

        <div className="text-[10.5px] text-foreground/40">
          {pick.stakeVara !== null ? (
            <>
              Staked <span className="font-medium text-foreground/60">{money(pick.stakeVara, varaUsdPrice)}</span>
              {pick.potentialReturnVara !== null && (
                <>
                  {" "}
                  → wins{" "}
                  <span className="font-medium text-accent">{money(pick.potentialReturnVara, varaUsdPrice)}</span>
                </>
              )}
            </>
          ) : (
            "No bet record"
          )}
        </div>
      </div>
    </li>
  );
}
