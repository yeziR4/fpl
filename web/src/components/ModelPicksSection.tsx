import type { ModelPicks } from "@/lib/agentPicks";

/**
 * Each model's full pick list for the most current gameweek -- "what
 * the agents actually said", not just the aggregate percentage bar
 * StakeMarket already shows on the markets grid. Requested directly
 * after "can we see the bets this models have made" -- deliberately
 * NOT a VARA figure next to each pick: these five wallets are
 * unfunded and have never staked (see docs/architecture.md's "AI
 * agent picks & leaderboard" section), so a dollar-looking number
 * here would just be invented. Confidence -- the model's own stated
 * conviction, real data it actually returned -- is what's shown
 * instead. A future "follow a model" feature would place a real stake
 * from the *viewer's own* wallet, never one of these; that's not
 * built yet, this section is answering "what would I be copying"
 * ahead of that.
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
}

export function ModelPicksSection({ gw, models, playerNames }: ModelPicksSectionProps) {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-4xl px-6 py-12 sm:px-10">
        <div className="mb-6 flex flex-col gap-2">
          <h2 className="font-display text-xl font-black uppercase tracking-[0.02em] text-foreground">
            Model picks — GW{gw}
          </h2>
          <p className="max-w-lg text-[13px] leading-relaxed text-foreground/50">
            What each model predicted and how confident it was. No VARA moves here — these
            wallets aren&rsquo;t funded and don&rsquo;t stake; picks are just scored against the
            real result once the gameweek finishes (see the leaderboard above).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {models.map((model) => (
            <ModelPickCard key={model.slug} model={model} playerNames={playerNames} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ModelPickCard({
  model,
  playerNames,
}: {
  model: ModelPicks;
  playerNames: Record<number, string>;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-foreground/12 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold text-foreground">{model.name}</span>
        <span className="text-[11px] text-foreground/35">{model.picks.length} picks</span>
      </div>

      {model.error ? (
        <p className="mt-3 text-[12px] leading-relaxed text-foreground/45">
          Errored this gameweek — <span className="font-mono text-[11px]">{model.error}</span>
        </p>
      ) : model.picks.length === 0 ? (
        <p className="mt-3 text-[12px] text-foreground/40">No picks recorded.</p>
      ) : (
        <ul className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
          {model.picks.map((pick) => (
            <li
              key={`${pick.playerId}-${pick.threshold}`}
              className="flex items-center justify-between gap-2 text-[12px]"
            >
              <span className="truncate text-foreground/75">
                {playerNames[pick.playerId] ?? `Player ${pick.playerId}`}{" "}
                <span className="text-foreground/40">Over {pick.threshold}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span
                  className={`font-semibold ${pick.side === "yes" ? "text-accent" : "text-foreground/50"}`}
                >
                  {pick.side === "yes" ? "Yes" : "No"}
                </span>
                {pick.confidence !== null && (
                  <span className="tabular-nums text-foreground/35">
                    {Math.round(pick.confidence * 100)}%
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
