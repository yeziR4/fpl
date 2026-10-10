"use client";

import { useState } from "react";
import { Avatar, LabBadge } from "@/components/research/Marks";
import type { Forecast, Participant } from "@/lib/study";

/**
 * The leaderboard: one row per participant, expandable to their individual calls.
 *
 * REBUILT from two separate tables that said the same thing twice. There was a
 * per-participant summary and then a seventeen-row table of every forecast, and a
 * reader had to hold one in their head while reading the other. Folding them
 * together means the summary is the index and the detail is one click away, which
 * also buys space -- an expanded participant costs nothing until somebody asks.
 *
 * Sorted by settled positions rather than alphabetically, because on a page about
 * who committed what, the ordering should be the answer to that question.
 *
 * A client component: a static export has no server to expand rows, and this is
 * the one place on the page where interaction genuinely earns its keep.
 */

const STATUS_LABEL: Record<Forecast["status"], { text: string; tone: string }> = {
  placed: { text: "on chain", tone: "text-accent" },
  unfilled: { text: "unfilled", tone: "text-amber-500" },
  "no-trade": { text: "no edge", tone: "text-foreground/40" },
  passed: { text: "passed", tone: "text-foreground/30" },
};

function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function usd(v: number | null): string {
  return v === null ? "—" : `$${v.toFixed(2)}`;
}
function signed(v: number | null): string {
  return v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}pp`;
}

interface Row {
  participant: Participant;
  forecasts: Forecast[];
  made: number;
  placed: number;
  committed: number;
  avgEdge: number | null;
}

export function ParticipantTable({ forecasts }: { forecasts: Forecast[] }) {
  const [open, setOpen] = useState<string | null>(null);

  const byParticipant = new Map<string, Forecast[]>();
  for (const f of forecasts) {
    const list = byParticipant.get(f.participant.id) ?? [];
    list.push(f);
    byParticipant.set(f.participant.id, list);
  }

  const rows: Row[] = [...byParticipant.entries()].map(([id, list]) => {
    const placed = list.filter((f) => f.status === "placed");
    const edges = list.map((f) => f.edge).filter((e): e is number => e !== null);
    return {
      participant: list[0].participant,
      forecasts: list,
      made: list.filter((f) => f.side !== null || f.probability !== null).length,
      placed: placed.length,
      committed: placed.reduce((s, f) => s + (f.stakeUsdc ?? 0), 0),
      avgEdge: edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : null,
    };
  });

  rows.sort(
    (a, b) =>
      b.placed - a.placed ||
      b.made - a.made ||
      (b.avgEdge ?? -1) - (a.avgEdge ?? -1) ||
      a.participant.name.localeCompare(b.participant.name),
  );

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-surface">
      <div className="grid grid-cols-[2.2fr_0.8fr_0.8fr_1fr_1fr] gap-3 border-b border-hairline px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/40">
        <span>Participant</span>
        <span className="text-right">Calls</span>
        <span className="text-right">On chain</span>
        <span className="text-right">Committed</span>
        <span className="text-right">Avg edge</span>
      </div>

      <div className="divide-y divide-hairline">
        {rows.map((r) => {
          const isOpen = open === r.participant.id;
          return (
            <div key={r.participant.id}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : r.participant.id)}
                aria-expanded={isOpen}
                className="grid w-full grid-cols-[2.2fr_0.8fr_0.8fr_1fr_1fr] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-strong"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`shrink-0 text-[10px] text-foreground/30 transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                    aria-hidden
                  >
                    ▶
                  </span>
                  {r.participant.kind === "human" ? (
                    <Avatar src={r.participant.avatarUrl} name={r.participant.name} />
                  ) : (
                    <LabBadge slug={r.participant.id} />
                  )}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-semibold text-foreground">
                      {r.participant.name}
                    </span>
                    <span className="truncate text-[10.5px] text-foreground/40">
                      {r.participant.kind === "human" ? r.participant.subtitle : r.participant.subtitle}
                    </span>
                  </span>
                </span>
                <span className="tnum text-right text-[12.5px] text-foreground/70">{r.made}</span>
                <span
                  className={`tnum text-right text-[12.5px] font-semibold ${
                    r.placed > 0 ? "text-accent" : "text-foreground/30"
                  }`}
                >
                  {r.placed}
                </span>
                <span className="tnum text-right text-[12.5px] text-foreground/70">
                  {r.committed ? `$${r.committed.toFixed(2)}` : "—"}
                </span>
                <span className="tnum text-right text-[12.5px] text-foreground/70">
                  {signed(r.avgEdge)}
                </span>
              </button>

              {isOpen && <Detail forecasts={r.forecasts} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The expanded view: what this participant actually called, market by market.
 *
 * Columns are narrower than the standalone table was, and the "reading the
 * columns" explainer that used to sit under it is gone -- it was four sentences
 * of legend for eleven columns, and the labels here are short enough to read
 * without one.
 */
function Detail({ forecasts }: { forecasts: Forecast[] }) {
  const ordered = [...forecasts].sort((a, b) => a.market.line - b.market.line || a.market.player.localeCompare(b.market.player));

  return (
    <div className="border-t border-hairline bg-surface-strong px-4 py-3">
      <div className="grid grid-cols-[1.6fr_0.6fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr] gap-2 pb-2 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-foreground/35">
        <span>Market</span>
        <span>Side</span>
        <span className="text-right">Stated P</span>
        <span className="text-right">Price</span>
        <span className="text-right">Edge</span>
        <span className="text-right">Stake</span>
        <span>Status</span>
      </div>

      {ordered.map((f) => {
        const status = STATUS_LABEL[f.status];
        const sideTone =
          f.side === "yes" ? "text-accent" : f.side === "no" ? "text-rose-400" : "text-foreground/25";
        return (
          <div key={f.key} className="border-t border-hairline/60 py-2">
            <div className="grid grid-cols-[1.6fr_0.6fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr] items-baseline gap-2">
              <span className="text-[12.5px] text-foreground/80">
                {f.market.player} {f.market.line}+
                <span className="ml-1.5 text-[10px] text-foreground/30">{f.market.position}</span>
              </span>
              <span className={`text-[11.5px] font-bold uppercase ${sideTone}`}>{f.side ?? "—"}</span>
              <span className="tnum text-right text-[12px] text-foreground/75">{pct(f.probability)}</span>
              <span className="tnum text-right text-[12px] text-foreground/50">
                {f.priceAtDecision === null ? "—" : f.priceAtDecision.toFixed(3)}
              </span>
              <span
                className={`tnum text-right text-[12px] font-semibold ${
                  f.edge === null
                    ? "text-foreground/25"
                    : f.edge > 0
                      ? "text-accent"
                      : "text-foreground/50"
                }`}
              >
                {signed(f.edge)}
              </span>
              <span className="tnum text-right text-[12px] text-foreground/75">{usd(f.stakeUsdc)}</span>
              <span className="flex flex-col gap-0.5">
                <span className={`text-[10.5px] font-semibold uppercase tracking-[0.05em] ${status.tone}`}>
                  {status.text}
                </span>
                {f.signature && (
                  <a
                    href={`https://solscan.io/tx/${f.signature}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] text-accent/80 underline-offset-2 hover:underline"
                  >
                    {f.signature.slice(0, 8)}…
                  </a>
                )}
              </span>
            </div>

            {f.reasoning && (
              <p className="mt-1.5 max-w-4xl text-[11.5px] leading-relaxed text-foreground/50">
                {f.reasoning}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
