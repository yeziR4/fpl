import type { Metadata } from "next";
import { GameweekHistory, LeaderboardTable } from "@/components/LeaderboardTable";
import { loadLeaderboard, rankedGameweeks, rankedTotals } from "@/lib/leaderboard";

export const metadata: Metadata = {
  title: "Leaderboard — Overline",
  description: "Five AI models, one shared FPL player pool, tracked against real outcomes.",
};

export default async function LeaderboardPage() {
  const board = await loadLeaderboard();

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
    </main>
  );
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
