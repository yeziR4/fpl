import { Avatar, LabBadge } from "@/components/research/Marks";
import { ALL_MARKETS, type Forecast } from "@/lib/study";

/**
 * The study table: every forecast by every participant, in one place.
 *
 * Deliberately a SPREADSHEET and not a card grid. The question this page exists
 * to answer is comparative -- which model priced this market best, who had an
 * edge and who had an opinion -- and comparison is what a table is for. Cards
 * look better in a screenshot and answer nothing.
 *
 * Sorted by market first, so the five models' views on the same question sit
 * next to each other. That adjacency is the whole point: Grok's lone YES on
 * Haaland is only legible when it is on the row below four NOs.
 *
 * Reasoning opens with <details>, which needs no JavaScript and therefore
 * survives a static export untouched.
 */

const STATUS_LABEL: Record<Forecast["status"], { text: string; tone: string }> = {
  placed: { text: "on chain", tone: "text-accent" },
  unfilled: { text: "unfilled", tone: "text-amber-500" },
  "no-trade": { text: "no edge", tone: "text-foreground/40" },
  passed: { text: "passed", tone: "text-foreground/30" },
};

function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function usd(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

function signed(value: number | null): string {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}pp`;
}

export function ForecastTable({ forecasts }: { forecasts: Forecast[] }) {
  const ordered = [...forecasts].sort(
    (a, b) =>
      ALL_MARKETS.findIndex((m) => m.marketId === a.market.marketId) -
        ALL_MARKETS.findIndex((m) => m.marketId === b.market.marketId) ||
      a.participant.name.localeCompare(b.participant.name),
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
      <table className="w-full min-w-[1080px] border-collapse text-left">
        <thead>
          <tr className="border-b border-hairline text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/40">
            <th className="px-3 py-2.5">Participant</th>
            <th className="px-3 py-2.5">Market</th>
            <th className="px-3 py-2.5">Side</th>
            <th className="px-3 py-2.5 text-right">Stated P</th>
            <th className="px-3 py-2.5 text-right">Pool price</th>
            <th className="px-3 py-2.5 text-right">Edge</th>
            <th className="px-3 py-2.5 text-right">Stake</th>
            <th className="px-3 py-2.5 text-right">Shares</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5">Reasoning</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((f) => (
            <Row key={f.key} f={f} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ f }: { f: Forecast }) {
  const status = STATUS_LABEL[f.status];
  const isHuman = f.participant.kind === "human";
  const sideTone =
    f.side === "yes" ? "text-accent" : f.side === "no" ? "text-rose-400" : "text-foreground/30";

  return (
    <tr className="border-b border-hairline align-top last:border-0 hover:bg-surface-strong">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {isHuman ? (
            <Avatar src={f.participant.avatarUrl} name={f.participant.name} />
          ) : (
            <LabBadge slug={f.participant.id} />
          )}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-semibold text-foreground">
              {f.participant.name}
            </span>
            <span className="truncate text-[10.5px] text-foreground/40">
              {isHuman ? "human" : f.participant.subtitle}
            </span>
          </div>
        </div>
      </td>

      <td className="px-3 py-2.5">
        <span className="text-[12.5px] text-foreground/75">
          {f.market.player} {f.market.line}+
        </span>
        <span className="ml-1.5 text-[10.5px] text-foreground/35">{f.market.position}</span>
      </td>

      <td className={`px-3 py-2.5 text-[12px] font-bold uppercase ${sideTone}`}>
        {f.side ?? "—"}
      </td>

      <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-foreground/80">
        {pct(f.probability)}
      </td>
      <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-foreground/55">
        {f.priceAtDecision === null ? "—" : f.priceAtDecision.toFixed(3)}
      </td>
      <td
        className={`tnum px-3 py-2.5 text-right text-[12.5px] font-semibold ${
          f.edge === null ? "text-foreground/30" : f.edge > 0 ? "text-accent" : "text-foreground/50"
        }`}
      >
        {signed(f.edge)}
      </td>
      <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-foreground/80">
        {usd(f.stakeUsdc)}
      </td>
      <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-foreground/55">
        {f.shares ?? "—"}
      </td>

      <td className="px-3 py-2.5">
        <span className={`text-[11px] font-semibold uppercase tracking-[0.05em] ${status.tone}`}>
          {status.text}
        </span>
        {f.signature && (
          <a
            href={`https://solscan.io/tx/${f.signature}`}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 block text-[10.5px] text-accent/80 underline-offset-2 hover:underline"
          >
            {f.signature.slice(0, 8)}…
          </a>
        )}
      </td>

      <td className="max-w-[320px] px-3 py-2.5">
        {f.reasoning ? (
          <details className="group [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer list-none text-[12px] leading-relaxed text-foreground/60">
              <span className="line-clamp-2 group-open:line-clamp-none">{f.reasoning}</span>
            </summary>
          </details>
        ) : (
          <span className="text-[11.5px] text-foreground/25">
            {f.status === "passed" ? "no forecast given" : "—"}
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Per-participant totals, which is the other half of "a spreadsheet of all the
 * data". Counts of forecasts made, how many reached the chain, and total capital
 * committed -- the numbers you would want before reading any individual row.
 */
export function ParticipantSummary({ forecasts }: { forecasts: Forecast[] }) {
  const byParticipant = new Map<string, Forecast[]>();
  for (const f of forecasts) {
    const list = byParticipant.get(f.participant.id) ?? [];
    list.push(f);
    byParticipant.set(f.participant.id, list);
  }

  const rows = [...byParticipant.entries()].map(([id, list]) => {
    const placed = list.filter((f) => f.status === "placed");
    const staked = placed.reduce((sum, f) => sum + (f.stakeUsdc ?? 0), 0);
    const edges = list.map((f) => f.edge).filter((e): e is number => e !== null);
    return {
      id,
      participant: list[0].participant,
      forecast: list.filter((f) => f.probability !== null).length,
      placed: placed.length,
      staked,
      avgEdge: edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : null,
    };
  });

  rows.sort((a, b) => b.placed - a.placed || (b.avgEdge ?? -1) - (a.avgEdge ?? -1));

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b border-hairline text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/40">
            <th className="px-3 py-2.5">Participant</th>
            <th className="px-3 py-2.5 text-right">Forecasts</th>
            <th className="px-3 py-2.5 text-right">On chain</th>
            <th className="px-3 py-2.5 text-right">Committed</th>
            <th className="px-3 py-2.5 text-right">Avg edge</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-hairline last:border-0 hover:bg-surface-strong">
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  {r.participant.kind === "human" ? (
                    <Avatar src={r.participant.avatarUrl} name={r.participant.name} />
                  ) : (
                    <LabBadge slug={r.id} />
                  )}
                  <span className="text-[13px] font-semibold text-foreground">{r.participant.name}</span>
                  <span className="text-[10.5px] text-foreground/35">
                    {r.participant.kind === "human" ? r.participant.subtitle : r.participant.subtitle}
                  </span>
                </div>
              </td>
              <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-foreground/70">{r.forecast}</td>
              <td className="tnum px-3 py-2.5 text-right text-[12.5px] font-semibold text-accent">
                {r.placed}
              </td>
              <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-foreground/70">
                {r.staked ? `$${r.staked.toFixed(2)}` : "—"}
              </td>
              <td className="tnum px-3 py-2.5 text-right text-[12.5px] text-foreground/70">
                {r.avgEdge === null ? "—" : signed(r.avgEdge)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
