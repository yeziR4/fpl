"use client";

/**
 * A live "kicks off in Xh Xm" countdown for a player's next fixture.
 *
 * Requested directly after a real user's confusion during the "My
 * Stakes" walkthrough turned into a separate, concrete ask: with most
 * of the gameweek already played, the cards for players who'd already
 * kicked off looked identical to the one match still to come (Arsenal
 * v Aston Villa at the time) -- nothing on the card said *when*, so
 * there was no way to tell "still open" from "about to lock" at a
 * glance. nextFixtureForTeam (lib/fpl.ts) only ever returns a
 * not-yet-finished fixture, so once `kickoffTime` is in the past here
 * the match is live/in-progress, not upcoming -- handled explicitly
 * below rather than showing a negative countdown.
 *
 * Client-only by necessity (setInterval, Date.now()) -- rendered from
 * MarketsSection's otherwise-server-rendered card grid.
 */

import { useEffect, useState } from "react";

const UPDATE_INTERVAL_MS = 30_000;

interface KickoffCountdownProps {
  /** ISO 8601 kickoff time. */
  kickoffTime: string;
}

export function KickoffCountdown({ kickoffTime }: KickoffCountdownProps) {
  const target = new Date(kickoffTime).getTime();
  // Lazy initializer, not an effect -- same `typeof window` guard
  // StatCountUp uses for its own client-only initial value. Server
  // (and the static-export prerender) always sees `null` and renders
  // nothing; a real browser fills it in on first render, no flash of
  // wrong content in between.
  const [now, setNow] = useState<number | null>(() =>
    typeof window !== "undefined" ? Date.now() : null,
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), UPDATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  if (now === null) return null;

  const diffMs = target - now;
  if (diffMs <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-accent">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />
        Live
      </span>
    );
  }

  return (
    <span className="text-[10.5px] font-medium tabular-nums text-foreground/45">
      Kicks off in {formatCountdown(diffMs)}
    </span>
  );
}

function formatCountdown(diffMs: number): string {
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
