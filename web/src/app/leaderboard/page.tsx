import type { Metadata } from "next";
import { GameweekHistory, LeaderboardTable } from "@/components/LeaderboardTable";
import { ModelPicksSection } from "@/components/ModelPicksSection";
import { loadLeaderboard, rankedGameweeks, rankedTotals } from "@/lib/leaderboard";
import { latestAgentPicksGw, loadAgentPicksForGw, type ModelPicks } from "@/lib/agentPicks";
import { fetchBootstrapStatic } from "@/lib/fpl";

export const metadata: Metadata = {
  title: "Leaderboard — Overline",
  description: "Five AI models, one shared FPL player pool, tracked against real outcomes.",
};

export default async function LeaderboardPage() {
  const [board, picksSection] = await Promise.all([loadLeaderboard(), loadLatestPicksSection()]);

  return (
    <main className="flex flex-1 flex-col">
      <section className="border-b border-foreground/10 bg-background">
        <div className="mx-auto max-w-4xl px-6 py-16 sm:px-10">
          <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">
            Agent leaderboard
          </span>
          <h1 className="mt-3 font-display text-4xl font-black uppercase leading-[0.98] text-foreground sm:text-5xl">
            Five models. Same picks.
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-foreground/60">
            Every gameweek, five top-tier AI models are given the same player pool and asked to
            predict the same points-threshold markets this site runs. Once a gameweek finishes,
            their picks are scored against the real result — no matchmaking, no stakes, just
            whether they were right.
          </p>
        </div>
      </section>

      <section className="bg-background">
        <div className="mx-auto max-w-4xl px-6 py-12 sm:px-10">
          {board ? (
            <>
              <LeaderboardTable totals={rankedTotals(board)} />
              <div className="mt-3 text-[11.5px] text-foreground/35">
                Updated {new Date(board.updated_at).toUTCString()}
              </div>

              <h2 className="mb-4 mt-12 font-display text-xl font-black uppercase tracking-[0.02em] text-foreground">
                By gameweek
              </h2>
              <GameweekHistory gameweeks={rankedGameweeks(board)} />
            </>
          ) : (
            <LeaderboardUnavailable />
          )}
        </div>
      </section>

      {picksSection && (
        <ModelPicksSection
          gw={picksSection.gw}
          models={picksSection.models}
          playerNames={picksSection.playerNames}
        />
      )}
    </main>
  );
}

/**
 * The newest gameweek's agent picks, paired with the player names to
 * render them with (bootstrap-static's the only place that mapping
 * lives). Failing soft to null on either fetch -- picks with no names
 * to show, or bootstrap-static being unreachable (see lib/fpl.ts's own
 * caveat about this sandbox's egress) -- just means this section
 * doesn't render, same "fail soft, not broken" contract loadMarketPlayers
 * in app/page.tsx already follows.
 */
async function loadLatestPicksSection(): Promise<{
  gw: number;
  models: ModelPicks[];
  playerNames: Record<number, string>;
} | null> {
  try {
    const gw = await latestAgentPicksGw();
    if (gw === null) return null;
    const models = await loadAgentPicksForGw(gw);
    if (!models) return null;

    const bootstrap = await fetchBootstrapStatic();
    const playerNames: Record<number, string> = {};
    for (const element of bootstrap.elements) {
      playerNames[element.id] = element.web_name;
    }

    return { gw, models, playerNames };
  } catch (error) {
    console.error("Failed to load model picks section:", error);
    return null;
  }
}

function LeaderboardUnavailable() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-foreground/15 px-6 py-16 text-center">
      <span className="font-display text-lg font-extrabold uppercase tracking-[0.04em] text-foreground/70">
        No scored gameweeks yet
      </span>
      <p className="max-w-sm text-[13.5px] leading-relaxed text-foreground/45">
        Agent picks are generated ahead of each gameweek&rsquo;s deadline and scored once it
        finishes. Check back after the next gameweek wraps up.
      </p>
    </div>
  );
}
