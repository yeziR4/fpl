import type { Metadata } from "next";
import { GameweekHistory, LeaderboardTable } from "@/components/LeaderboardTable";
import { ModelPicksSection, type PickPlayerInfo } from "@/components/ModelPicksSection";
import { loadLeaderboard, rankedGameweeks, rankedTotals } from "@/lib/leaderboard";
import { latestAgentPicksGw, loadAgentPicksForGw, type ModelPicks } from "@/lib/agentPicks";
import {
  fetchBootstrapStatic,
  fetchFixtures,
  fixturesForTeamInGw,
  playerPhotoUrl,
  teamBadgeUrl,
  teamCodeForId,
} from "@/lib/fpl";
import { fetchVaraUsdPrice } from "@/lib/vara/price";

export const metadata: Metadata = {
  title: "Leaderboard — Overline",
  description: "Five AI models, one shared FPL player pool, tracked against real outcomes.",
};

export default async function LeaderboardPage() {
  // Fetched once, shared by every VARA figure on this page -- VARA is
  // the real unit these bet records are stored in, but the page reads
  // in dollars throughout (requested directly: "just use $$$... the
  // only time we will need vara is when they want to pay or get
  // paid" -- nothing on this page pays or gets paid, it's simulated).
  // null (fetch failed) falls back to showing VARA, never a fabricated
  // dollar figure -- same discipline every other price-derived display
  // in this app already follows.
  const [board, picksSection, varaUsdPrice] = await Promise.all([
    loadLeaderboard(),
    loadLatestPicksSection(),
    fetchVaraUsdPrice(),
  ]);

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
            predict the same points-threshold markets this site runs, each staking a simulated
            amount sized off its own confidence. Once a gameweek finishes, their picks are scored
            against the real result — same player pool, same information, no matchmaking between
            them.
          </p>
        </div>
      </section>

      <section className="bg-background">
        <div className="mx-auto max-w-4xl px-6 py-12 sm:px-10">
          {board ? (
            <>
              <LeaderboardTable totals={rankedTotals(board)} varaUsdPrice={varaUsdPrice} />
              <div className="mt-3 text-[11.5px] text-foreground/35">
                Updated {new Date(board.updated_at).toUTCString()}
              </div>

              <h2 className="mb-4 mt-12 font-display text-xl font-black uppercase tracking-[0.02em] text-foreground">
                By gameweek
              </h2>
              <GameweekHistory gameweeks={rankedGameweeks(board)} varaUsdPrice={varaUsdPrice} />
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
          playerInfo={picksSection.playerInfo}
          varaUsdPrice={varaUsdPrice}
        />
      )}
    </main>
  );
}

/**
 * The newest gameweek's agent picks, paired with each referenced
 * player's name/photo/opponent (bootstrap-static + the fixture list
 * are the only places that data lives) -- what lets ModelPicksSection
 * show a face and a match per pick, not just a bare name. Only resolved
 * for players actually referenced by at least one pick, not the whole
 * player pool. Failing soft to null on any fetch -- picks with nothing
 * to render them with, or bootstrap-static/fixtures being unreachable
 * (see lib/fpl.ts's own caveat about this sandbox's egress) -- just
 * means this section doesn't render, same "fail soft, not broken"
 * contract loadMarketPlayers in app/page.tsx already follows.
 */
async function loadLatestPicksSection(): Promise<{
  gw: number;
  models: ModelPicks[];
  playerInfo: Record<number, PickPlayerInfo>;
} | null> {
  try {
    const gw = await latestAgentPicksGw();
    if (gw === null) return null;
    const models = await loadAgentPicksForGw(gw);
    if (!models) return null;

    const [bootstrap, fixtures] = await Promise.all([fetchBootstrapStatic(), fetchFixtures()]);

    const playerIds = new Set<number>();
    for (const model of models) {
      for (const pick of model.picks) playerIds.add(pick.playerId);
    }

    const playerInfo: Record<number, PickPlayerInfo> = {};
    for (const id of playerIds) {
      const element = bootstrap.elements.find((e) => e.id === id);
      if (!element) continue; // moved out of bootstrap-static's pool since picks were generated

      const fixture = fixturesForTeamInGw(element.team, gw, fixtures)[0] ?? null;
      const opponentTeam = fixture ? bootstrap.teams.find((t) => t.id === fixture.teamId) : undefined;

      playerInfo[id] = {
        webName: element.web_name,
        photoUrl: element.has_temporary_code ? null : playerPhotoUrl(element.code, "40x40"),
        opponent:
          fixture && opponentTeam
            ? {
                badgeUrl: teamBadgeUrl(teamCodeForId(bootstrap, fixture.teamId)),
                shortName: opponentTeam.short_name,
                isHome: fixture.isHome,
              }
            : null,
      };
    }

    return { gw, models, playerInfo };
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
