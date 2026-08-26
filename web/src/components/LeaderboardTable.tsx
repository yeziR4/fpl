import type { ReactNode } from "react";
import type { GameweekSummary, ModelTotal } from "@/lib/leaderboard";

function formatAccuracy(accuracy: number | null): string {
  return accuracy === null ? "—" : `${Math.round(accuracy * 100)}%`;
}

export function LeaderboardTable({ totals }: { totals: ModelTotal[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-foreground/12">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-foreground/12 bg-white/[0.03]">
            <Th className="w-12">#</Th>
            <Th>Model</Th>
            <Th className="text-right">Correct</Th>
            <Th className="text-right">Wrong</Th>
            <Th className="text-right">Pending</Th>
            <Th className="text-right">Accuracy</Th>
          </tr>
        </thead>
        <tbody>
          {totals.map((model, i) => (
            <tr
              key={model.slug}
              className="border-b border-foreground/8 last:border-b-0 hover:bg-white/[0.02]"
            >
              <td className="px-4 py-3 font-display text-[15px] font-black text-foreground/40">
                {i + 1}
              </td>
              <td className="px-4 py-3">
                <span className="text-[14px] font-semibold text-foreground">{model.name}</span>
                <span className="ml-2 font-mono text-[11px] text-foreground/35">{model.slug}</span>
              </td>
              <td className="px-4 py-3 text-right text-[13.5px] font-medium text-accent">
                {model.correct}
              </td>
              <td className="px-4 py-3 text-right text-[13.5px] font-medium text-foreground/60">
                {model.wrong}
              </td>
              <td className="px-4 py-3 text-right text-[13.5px] font-medium text-foreground/40">
                {model.pending}
              </td>
              <td className="px-4 py-3 text-right font-display text-[15px] font-black text-foreground">
                {formatAccuracy(model.accuracy)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground/45 ${className}`}
    >
      {children}
    </th>
  );
}

export function GameweekHistory({ gameweeks }: { gameweeks: GameweekSummary[] }) {
  return (
    <div className="flex flex-col gap-4">
      {gameweeks.map((gw) => (
        <div key={gw.gw} className="rounded-lg border border-foreground/12 bg-white/[0.02] p-4">
          <span className="font-display text-[13px] font-black uppercase tracking-[0.04em] text-accent">
            Gameweek {gw.gw}
          </span>
          <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5">
            {gw.models.map((m) => (
              <div key={m.slug} className="flex items-center gap-1.5 text-[12.5px]">
                <span className="font-medium text-foreground/70">{m.name}</span>
                <span className="text-foreground/40">
                  {m.correct}/{m.correct + m.wrong}
                  {m.pending > 0 ? ` (+${m.pending} pending)` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
