"use client";

import { useEffect, useState } from "react";
import type { GameUser } from "@/lib/game/GameProvider";

export function CommunityLeaderboard() {
  const [leaders, setLeaders] = useState<GameUser[]>([]);
  const baseUrl = process.env.NEXT_PUBLIC_FAUCET_URL;

  useEffect(() => {
    if (!baseUrl) return;
    fetch(`${baseUrl.replace(/\/$/, "")}/game/leaderboard`)
      .then((response) => response.json())
      .then((payload: { leaders?: GameUser[] }) => setLeaders(payload.leaders ?? []))
      .catch(() => undefined);
  }, [baseUrl]);

  return (
    <section className="border-b border-foreground/10 bg-accent/[0.035]">
      <div className="mx-auto max-w-4xl px-6 py-14 sm:px-10">
        <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">Community league</span>
        <div className="mt-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-display text-4xl font-black uppercase">The race for the podium</h1>
            <p className="mt-2 text-sm text-foreground/55">Free-to-play virtual predictions. Top three eligible players receive the announced community prizes.</p>
          </div>
          <div className="flex gap-2 text-center text-xs font-bold">
            <Prize place="1st" /><Prize place="2nd" /><Prize place="3rd" />
          </div>
        </div>
        <div className="mt-8 overflow-hidden rounded-lg border border-foreground/12">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-[10px] uppercase tracking-[0.08em] text-foreground/45"><tr><th className="px-4 py-3">Rank</th><th className="px-4 py-3">Player</th><th className="px-4 py-3 text-right">Predictions</th><th className="px-4 py-3 text-right">Balance</th><th className="px-4 py-3 text-right">Profit</th></tr></thead>
            <tbody>
              {leaders.length ? leaders.map((leader, index) => (
                <tr key={leader.username} className="border-t border-foreground/8">
                  <td className="px-4 py-3 font-display text-lg font-black text-accent">{index + 1}</td>
                  <td className="px-4 py-3 font-semibold">@{leader.username}</td>
                  <td className="px-4 py-3 text-right text-foreground/60">{leader.predictions}</td>
                  <td className="px-4 py-3 text-right font-semibold">{leader.balance.toFixed(1)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${leader.netProfit >= 0 ? "text-accent" : "text-red-300"}`}>{leader.netProfit >= 0 ? "+" : ""}{leader.netProfit.toFixed(1)}</td>
                </tr>
              )) : <tr><td colSpan={5} className="px-4 py-10 text-center text-foreground/40">The first prediction takes the top spot.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Prize({ place }: { place: string }) {
  return <span className="rounded border border-accent/30 bg-accent/10 px-3 py-2 text-accent">{place}</span>;
}
