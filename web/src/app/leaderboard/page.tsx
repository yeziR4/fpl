import type { Metadata } from "next";
import { GameweekHistory, LeaderboardTable } from "@/components/LeaderboardTable";
import { ModelPicksSection, type ModelHistory, type PickPlayerInfo } from "@/components/ModelPicksSection";
import { loadLeaderboard, rankedGameweeks, rankedTotals, type Leaderboard } from "@/lib/leaderboard";
import { allAgentPicksGws, loadAgentPicksForGw } from "@/lib/agentPicks";
import {
  fetchBootstrapStatic,
  fetchFixtures,
  fixturesForTeamInGw,
  playerPhotoUrl,
  teamBadgeUrl,
  teamCodeForId,
  type BootstrapStatic,
  type Fixture,
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
  // loadPicksHistory() needs the scored leaderboard itself (to attach
  // each gameweek's correct/wrong/accuracy summary to that gameweek's
  // bets), so this one isn't independent of loadLeaderboard() the way
  // the other two are.
  const board = await loadLeaderboard();
  const [models, varaUsdPrice] = await Promise.all([loadPicksHistory(board), fetchVaraUsdPrice()]);

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

      {models.length > 0 && <ModelPicksSection models={models} varaUsdPrice={varaUsdPrice} />}
    </main>
  );
}

/**
 * Every model's full bet history across every gameweek with a saved
 * picks file, newest gameweek first -- "no i am saying their previous
 * bets not only the future [one]", requested directly after a
 * latest-gameweek-only version shipped. Each pick is paired with its
 * player's name/photo/opponent for THAT specific gameweek
 * (bootstrap-static + the fixture list are the only places that data
 * lives) -- what lets ModelPicksSection show a face and a match per
 * pick, not just a bare name, and get a player's opponent right even
 * for a gameweek that's since finished. Resolved once per player
 * PER GAMEWEEK (an opponent obviously isn't the same every week), only
 * for players actually referenced by at least one pick that gameweek.
 *
 * `board` supplies each gameweek's scored correct/wrong/accuracy
 * summary per model, so a model's history reads as "here's what it
 * bet, and here's how that gameweek actually went" without this
 * function re-deriving win/loss itself -- data_pipeline/leaderboard.py
 * already computed that once, off the real settlement-safe resolution
 * logic; duplicating it here in JS would risk a second, possibly
 * disagreeing definition of "correct."
 *
 * Failing soft to an empty list on any fetch -- a gameweek with
 * nothing to render its picks with, or bootstrap-static/fixtures being
 * unreachable (see lib/fpl.ts's own caveat about this sandbox's
 * egress) -- just means that gameweek (or the whole section) doesn't
 * render, same "fail soft, not broken" contract loadMarketPlayers in
 * app/page.tsx already follows.
 */
async function loadPicksHistory(board: Leaderboard | null): Promise<ModelHistory[]> {
  try {
    const gws = await allAgentPicksGws();
    if (gws.length === 0) return [];

    // Bootstrap-static is a single CURRENT-state snapshot -- fine to
    // share across every gameweek's player names/photos (those don't
    // change), but fixtures need to be re-queried per gameweek below
    // via fixturesForTeamInGw, since an opponent very much does.
    const [bootstrap, fixtures] = await Promise.all([fetchBootstrapStatic(), fetchFixtures()]);

    const bySlug = new Map<string, ModelHistory>();

    for (const gw of gws) {
      const models = await loadAgentPicksForGw(gw);
      if (!models) continue;

      for (const model of models) {
        let history = bySlug.get(model.slug);
        if (!history) {
          history = { slug: model.slug, name: model.name, gameweeks: [] };
          bySlug.set(model.slug, history);
        }

        const gwSummary = board?.gameweeks[String(gw)]?.models.find((m) => m.slug === model.slug);

        history.gameweeks.push({
          gw,
          error: model.error,
          picks: model.picks.map((pick) => ({
            ...pick,
            player: resolvePlayerInfo(pick.playerId, gw, bootstrap, fixtures),
            outcome:
              gwSummary?.picks?.find((p) => p.player_id === pick.playerId && p.threshold === pick.threshold)
                ?.outcome ?? null,
          })),
          summary: gwSummary
            ? {
                correct: gwSummary.correct,
                wrong: gwSummary.wrong,
                pending: gwSummary.pending,
                accuracy: gwSummary.accuracy,
                stakedVara: gwSummary.staked_vara,
                simulatedPnlVara: gwSummary.simulated_pnl_vara,
              }
            : null,
        });
      }
    }

    // gws is already newest-first (allAgentPicksGws), and each model's
    // gameweeks were pushed in that same order, so no further sort
    // needed here.
    return Array.from(bySlug.values());
  } catch (error) {
    console.error("Failed to load model picks history:", error);
    return [];
  }
}

function resolvePlayerInfo(
  playerId: number,
  gw: number,
  bootstrap: BootstrapStatic,
  fixtures: Fixture[],
): PickPlayerInfo | null {
  const element = bootstrap.elements.find((e) => e.id === playerId);
  if (!element) return null; // moved out of bootstrap-static's pool since this pick was made

  const fixture = fixturesForTeamInGw(element.team, gw, fixtures)[0] ?? null;
  const opponentTeam = fixture ? bootstrap.teams.find((t) => t.id === fixture.teamId) : undefined;

  return {
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
