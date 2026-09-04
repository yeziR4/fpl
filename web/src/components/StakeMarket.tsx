"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentPickCounts } from "@/lib/agentPicks";
import { useGame } from "@/lib/game/GameProvider";

type Side = "yes" | "no";
type Totals = { yes: number; no: number };

interface StakeMarketProps {
  playerId: number;
  playerName: string;
  gw: number | null;
  threshold: number;
  label: string;
  agentPicks: AgentPickCounts | null;
}

export function StakeMarket({ playerId, playerName, gw, threshold, label, agentPicks }: StakeMarketProps) {
  const game = useGame();
  const baseUrl = process.env.NEXT_PUBLIC_FAUCET_URL;
  const marketId = `${playerId}:${gw ?? "none"}:${threshold}`;
  const [totals, setTotals] = useState<Totals>({ yes: 250, no: 250 });
  const [pendingSide, setPendingSide] = useState<Side | null>(null);
  const [stake, setStake] = useState("25");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [telegraphVerified, setTelegraphVerified] = useState(false);

  useEffect(() => {
    if (!baseUrl || gw === null) return;
    const controller = new AbortController();
    fetch(`${baseUrl.replace(/\/$/, "")}/game/market?id=${encodeURIComponent(marketId)}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((payload: { totals?: Totals }) => payload.totals && setTotals(payload.totals))
      .catch(() => undefined);
    return () => controller.abort();
  }, [baseUrl, gw, marketId]);

  const amount = Number(stake);
  const projected = useMemo(() => projectedReturn(totals, pendingSide, amount), [totals, pendingSide, amount]);
  const pool = totals.yes + totals.no;
  const yesOdds = pool / totals.yes;
  const noOdds = pool / totals.no;
  const agentYes = agentPicks?.yes ?? 0;
  const agentNo = agentPicks?.no ?? 0;

  async function confirm() {
    if (!pendingSide || gw === null) return;
    setBusy(true);
    setFeedback(null);
    const result = await game.placePrediction({ marketId, playerName, label, side: pendingSide, stake: amount });
    setBusy(false);
    if (result.error) {
      setFeedback({ ok: false, message: result.error });
      return;
    }
    setTotals((current) => ({ ...current, [pendingSide]: current[pendingSide] + amount }));
    setTelegraphVerified(Boolean(result.telegraph && typeof result.telegraph === "object" && "ok" in result.telegraph && result.telegraph.ok));
    setFeedback({ ok: true, message: `Prediction locked: ${pendingSide.toUpperCase()} for ${amount.toFixed(0)} credits.` });
    setPendingSide(null);
  }

  if (gw === null) return <span className="text-[11px] text-foreground/35">No fixture this gameweek</span>;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-foreground/10 bg-black/15 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground/65">{label}</span>
        <span className="text-[9px] uppercase tracking-[0.08em] text-accent">GW{gw} · live pool</span>
      </div>
      {agentPicks && <div className="text-[10px] text-foreground/40">Agent signal: {agentYes} yes · {agentNo} no</div>}
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" onClick={() => { setPendingSide("yes"); setFeedback(null); }} className={`rounded border px-2 py-2 text-left transition ${pendingSide === "yes" ? "border-accent bg-accent text-[#05100d]" : "border-accent/45 bg-accent/10 text-accent hover:bg-accent/20"}`}>
          <span className="block text-[10px] font-semibold uppercase">Yes</span><span className="font-display text-lg font-black">{yesOdds.toFixed(2)}x</span>
        </button>
        <button type="button" onClick={() => { setPendingSide("no"); setFeedback(null); }} className={`rounded border px-2 py-2 text-left transition ${pendingSide === "no" ? "border-foreground bg-foreground text-background" : "border-foreground/25 text-foreground/75 hover:border-foreground/50"}`}>
          <span className="block text-[10px] font-semibold uppercase">No</span><span className="font-display text-lg font-black">{noOdds.toFixed(2)}x</span>
        </button>
      </div>
      {pendingSide && (
        <div className="rounded-md border border-foreground/12 bg-white/[0.03] p-2.5">
          <div className="flex items-center gap-2">
            <input type="number" min="1" step="1" value={stake} onChange={(event) => setStake(event.target.value)} aria-label="Virtual credit stake" className="min-w-0 flex-1 rounded border border-foreground/20 bg-black/20 px-2.5 py-2 text-xs outline-none focus:border-accent" />
            <button disabled={busy || !Number.isFinite(amount) || amount < 1} onClick={() => void confirm()} className="rounded bg-accent px-3 py-2 text-xs font-bold text-[#05100d] disabled:opacity-40">{busy ? "Locking…" : "Predict"}</button>
          </div>
          <div className="mt-1.5 text-[10px] text-foreground/45">Virtual stake · estimated return <span className="font-semibold text-accent">{projected.toFixed(1)} credits</span></div>
          {!game.user && <div className="mt-1 text-[10px] text-foreground/45">Sign in above to play.</div>}
        </div>
      )}
      {feedback && <div className={`text-[10px] ${feedback.ok ? "text-accent" : "text-red-300"}`}>{feedback.message}</div>}
      {telegraphVerified && <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-accent">✓ Telegraph intelligence routed and paid via x402</div>}
    </div>
  );
}

function projectedReturn(totals: Totals, side: Side | null, stake: number): number {
  if (!side || !Number.isFinite(stake) || stake <= 0) return 0;
  const newPool = totals.yes + totals.no + stake;
  return (stake * newPool) / (totals[side] + stake);
}
