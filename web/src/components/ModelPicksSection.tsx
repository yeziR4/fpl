import type { ModelPicks } from "@/lib/agentPicks";
import { formatUsd } from "@/lib/vara/price";

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
 */

interface ModelPicksSectionProps {
  gw: number;
  models: ModelPicks[];
  /** player_id -> display name, resolved from bootstrap-static at
   * build time. A pick for an id not in this map (should only happen
   * if bootstrap-static's player pool moved between when picks were
   * generated and when this page builds) falls back to the raw id
   * rather than hiding the pick. */
  playerNames: Record<number, string>;
  /** Live VARA/USD rate this page fetched once, or null if that fetch
   * failed -- every dollar figure in this section is `stakeVara *
   * varaUsdPrice`, computed at render time rather than stored, so it
   * reflects today's rate, not necessarily the rate in effect the
   * moment a model's bet was sized. Falls back to showing the raw
   * VARA amount when null, never a fabricated dollar figure. */
  varaUsdPrice: number | null;
}

export function ModelPicksSection({ gw, models, playerNames, varaUsdPrice }: ModelPicksSectionProps) {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-4xl px-6 py-12 sm:px-10">
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {models.map((model) => (
            <ModelPickCard key={model.slug} model={model} playerNames={playerNames} varaUsdPrice={varaUsdPrice} />
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
  playerNames,
  varaUsdPrice,
}: {
  model: ModelPicks;
  playerNames: Record<number, string>;
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
        <p className="mt-3 text-[12px] text-foreground/40">No picks recorded.</p>
      ) : (
        <ul className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
          {model.picks.map((pick) => (
            <li
              key={`${pick.playerId}-${pick.threshold}`}
              className="flex flex-col gap-0.5 border-b border-foreground/5 pb-2 text-[12px] last:border-b-0 last:pb-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-foreground/75">
                  {playerNames[pick.playerId] ?? `Player ${pick.playerId}`}{" "}
                  <span className="text-foreground/40">Over {pick.threshold}</span>
                </span>
                <span
                  className={`shrink-0 font-semibold ${pick.side === "yes" ? "text-accent" : "text-foreground/50"}`}
                >
                  {pick.side === "yes" ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[10.5px] text-foreground/40">
                <span>
                  {pick.stakeVara !== null ? (
                    <>
                      Staked <span className="font-medium text-foreground/60">{money(pick.stakeVara, varaUsdPrice)}</span>
                      {pick.potentialReturnVara !== null && (
                        <>
                          {" "}
                          → wins{" "}
                          <span className="font-medium text-accent">
                            {money(pick.potentialReturnVara, varaUsdPrice)}
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    "No bet record"
                  )}
                </span>
                {pick.confidence !== null && <span>{Math.round(pick.confidence * 100)}% confident</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
