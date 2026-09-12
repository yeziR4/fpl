import Image from "next/image";
import type { ModelPicks } from "@/lib/agentPicks";
import { formatUsd } from "@/lib/vara/price";
import { PlayerPhoto } from "@/components/PlayerPhoto";

/**
 * Each model's full pick list for the most current gameweek, now as a
 * real bet record per pick, not just a confidence percentage --
 * requested directly: "we create a new model bets records that show
 * the amount of vara that should be put in and they should be well
 * aware of the amount that can be won". Simulated, not real money
 * (these five wallets hold nothing and never stake for real, see
 * docs/architecture.md's "AI agent picks & leaderboard" section), but
 * a real, computed number now: stakeVara is a model's own confidence
 * slicing up its fixed gameweek bankroll (data_pipeline/oddsmaker.py),
 * marketProbability/potentialReturnVara come from this system's own
 * rank-based odds, never the model's opinion -- a model can't buy
 * better odds just by claiming more confidence. Total staked per model
 * doubles as a plain "how aggressive is this one" signal at a glance.
 *
 * Shown in dollars throughout, VARA kept purely as the backend unit --
 * requested directly: "the vara mechanism should be at the backend...
 * the only time we will need vara is when they want to pay or get
 * paid" -- nothing here pays or gets paid, it's simulated, so there's
 * no reason to make a reader do the VARA arithmetic themselves.
 *
 * Each pick now carries a face, not just a name -- a player photo and
 * their actual opponent for this specific gameweek (see
 * lib/fpl.ts's fixturesForTeamInGw), the same visual language the
 * markets grid itself uses -- requested directly after the plain-text
 * version shipped: "visualize the model picks better add player
 * picture and matches". A pick for a player this build's playerInfo
 * map doesn't cover (bootstrap-static's pool moved between when picks
 * were generated and when this page builds) falls back to a bare id
 * and no photo/opponent, never hides the pick.
 */

export interface PickPlayerInfo {
  webName: string;
  photoUrl: string | null;
  opponent: { badgeUrl: string; shortName: string; isHome: boolean } | null;
}

interface ModelPicksSectionProps {
  gw: number;
  models: ModelPicks[];
  /** player_id -> name/photo/opponent, resolved from bootstrap-static
   * and the fixture list at build time (see lib/fpl.ts). */
  playerInfo: Record<number, PickPlayerInfo>;
  /** Live VARA/USD rate this page fetched once, or null if that fetch
   * failed -- every dollar figure in this section is `stakeVara *
   * varaUsdPrice`, computed at render time rather than stored, so it
   * reflects today's rate, not necessarily the rate in effect the
   * moment a model's bet was sized. Falls back to showing the raw
   * VARA amount when null, never a fabricated dollar figure. */
  varaUsdPrice: number | null;
}

export function ModelPicksSection({ gw, models, playerInfo, varaUsdPrice }: ModelPicksSectionProps) {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-5xl px-6 py-12 sm:px-10">
        <div className="mb-6 flex flex-col gap-2">
          <h2 className="font-display text-xl font-black uppercase tracking-[0.02em] text-foreground">
            Model bets — GW{gw}
          </h2>
          <p className="max-w-lg text-[13px] leading-relaxed text-foreground/50">
            Each model&rsquo;s pick, what it staked (sized off its own confidence), and what it
            stands to win at this system&rsquo;s own odds. Simulated — no real money moves here —
            but every number is real, computed from a real formula, not invented.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {models.map((model) => (
            <ModelPickCard key={model.slug} model={model} playerInfo={playerInfo} varaUsdPrice={varaUsdPrice} />
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

function ModelPickCard({
  model,
  playerInfo,
  varaUsdPrice,
}: {
  model: ModelPicks;
  playerInfo: Record<number, PickPlayerInfo>;
  varaUsdPrice: number | null;
}) {
  const totalStaked = model.picks.reduce((sum, p) => sum + (p.stakeVara ?? 0), 0);

  return (
    <div className="flex flex-col rounded-lg border border-foreground/12 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold text-foreground">{model.name}</span>
        <span className="text-[11px] text-foreground/35">
          {model.picks.length} picks
          {totalStaked > 0 && ` · ${money(totalStaked, varaUsdPrice)} staked`}
        </span>
      </div>

      {model.error ? (
        <p className="mt-3 text-[12px] leading-relaxed text-foreground/45">
          Errored this gameweek — <span className="font-mono text-[11px]">{model.error}</span>
        </p>
      ) : model.picks.length === 0 ? (
        <p className="mt-3 text-[12px] text-foreground/40">
          No bets this gameweek — saw no real edge anywhere.
        </p>
      ) : (
        <ul className="mt-3 flex max-h-96 flex-col gap-2.5 overflow-y-auto pr-1">
          {model.picks.map((pick) => (
            <PickRow
              key={`${pick.playerId}-${pick.threshold}`}
              pick={pick}
              info={playerInfo[pick.playerId]}
              varaUsdPrice={varaUsdPrice}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PickRow({
  pick,
  info,
  varaUsdPrice,
}: {
  pick: ModelPicks["picks"][number];
  info: PickPlayerInfo | undefined;
  varaUsdPrice: number | null;
}) {
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
          <span
            className={`shrink-0 font-semibold ${pick.side === "yes" ? "text-accent" : "text-foreground/50"}`}
          >
            {pick.side === "yes" ? "Yes" : "No"}
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
