"use client";

/**
 * One (player, gw, threshold) market's stake UI: a percentage-of-
 * participants bar (agents + real human stakers, combined) plus the
 * actual Yes/No buttons -- these used to render with no onClick at
 * all (a mockup, not a working market). Now wired end to end: clicking
 * a side opens a small amount input, confirming signs and submits a
 * real transfer via WalletProvider.placeStake (see lib/vara/stake.ts
 * and faucet/src/MarketLedger.ts).
 *
 * Two different "yes/no" figures are both real and both shown,
 * deliberately not collapsed into one number:
 *   - participant counts (this bar): how many of the 5 agents plus how
 *     many distinct human stakers picked each side -- one vote each,
 *     a whale staking 100 VARA doesn't outweigh someone staking 1.
 *   - VARA amounts (the caption underneath): how much is actually
 *     staked on each side -- what the eventual payout math cares about.
 */

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/vara/WalletProvider";
import type { AgentPickCounts } from "@/lib/agentPicks";
import { fetchMarketTotals, stakeErrorMessage, type MarketTotals, type Side } from "@/lib/vara/stake";

interface StakeMarketProps {
  playerId: number;
  /** Display-only, carried through to WalletProvider.placeStake so a
   * recorded stake reads as "Haaland -- Over 5 pts" in "My Stakes"
   * (see stakeHistory.ts) instead of a bare player id. */
  playerName: string;
  /** null: no fixture this gameweek (blank/double gameweek, or not yet
   * scheduled) -- staking is disabled rather than guessing which
   * gameweek a stake would even resolve against. */
  gw: number | null;
  threshold: number;
  label: string;
  /** How the 5 agent models picked this market, read at build time.
   * null if no picks exist yet for this gameweek (not the same as
   * {yes: 0, no: 0}, which would look like they picked evenly). */
  agentPicks: AgentPickCounts | null;
}

export function StakeMarket({ playerId, playerName, gw, threshold, label, agentPicks }: StakeMarketProps) {
  const wallet = useWallet();
  const [totals, setTotals] = useState<MarketTotals | null>(null);
  const [pendingSide, setPendingSide] = useState<Side | null>(null);
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const faucetUrl = process.env.NEXT_PUBLIC_FAUCET_URL;
  const marketOpen = Boolean(faucetUrl) && gw !== null;

  useEffect(() => {
    if (!faucetUrl || gw === null) return;
    let cancelled = false;
    void fetchMarketTotals({ faucetUrl, playerId, gw, threshold }).then((t) => {
      if (!cancelled) setTotals(t);
    });
    return () => {
      cancelled = true;
    };
  }, [faucetUrl, gw, playerId, threshold]);

  async function confirmStake(side: Side) {
    if (gw === null) return;
    if (wallet.status !== "ready") {
      setFeedback({ ok: false, message: "Create a wallet first." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await wallet.placeStake({ playerId, playerName, gw, threshold, label, side, amountVara: amount });
    setBusy(false);
    if (result.ok) {
      setTotals({ yes: result.yes, no: result.no, yesCount: result.yesCount, noCount: result.noCount });
      setPendingSide(null);
      setFeedback({ ok: true, message: `Staked ${amount} VARA on ${side === "yes" ? "Yes" : "No"}` });
    } else {
      setFeedback({ ok: false, message: stakeErrorMessage(result.error) });
    }
  }

  const agentYes = agentPicks?.yes ?? 0;
  const agentNo = agentPicks?.no ?? 0;
  const humanYes = totals?.yesCount ?? 0;
  const humanNo = totals?.noCount ?? 0;
  const participantYes = agentYes + humanYes;
  const participantNo = agentNo + humanNo;
  const participantTotal = participantYes + participantNo;
  const yesPct = participantTotal > 0 ? Math.round((participantYes / participantTotal) * 100) : null;

  const varaYes = totals ? Number(totals.yes) : 0;
  const varaNo = totals ? Number(totals.no) : 0;
  const varaStaked = varaYes + varaNo;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground/50">{label}</span>
        {yesPct !== null && (
          <span className="text-[11px] font-semibold tabular-nums text-foreground/70">{yesPct}% Yes</span>
        )}
      </div>

      {yesPct !== null && (
        <>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
            <div className="bg-accent" style={{ width: `${yesPct}%` }} />
          </div>
          <span className="text-[10px] leading-snug text-foreground/35">
            {participantYes}/{participantTotal} picked Yes
            {agentPicks && ` — ${agentYes + agentNo} agent${agentYes + agentNo === 1 ? "" : "s"}`}
            {totals && humanYes + humanNo > 0
              ? `, ${humanYes + humanNo} ${humanYes + humanNo === 1 ? "person" : "people"}`
              : ""}
            {varaStaked > 0 && ` · ${totals!.yes}/${totals!.no} VARA`}
          </span>
        </>
      )}

      {!marketOpen ? (
        <span className="text-[11px] text-foreground/35">
          {gw === null ? "No fixture this gameweek" : "Staking isn't open yet"}
        </span>
      ) : pendingSide ? (
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min="0.01"
            step="0.1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Stake amount in VARA"
            className="w-16 rounded border border-foreground/20 bg-white/[0.03] px-1.5 py-1.5 text-[11.5px] text-foreground outline-none focus:border-accent/60"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirmStake(pendingSide)}
            className="flex-1 rounded bg-accent px-2 py-1.5 text-[11.5px] font-semibold text-[#05100d] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Staking…" : `Confirm ${pendingSide === "yes" ? "Yes" : "No"}`}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setPendingSide(null)}
            aria-label="Cancel"
            className="rounded px-1.5 py-1.5 text-[13px] text-foreground/40 hover:text-foreground/70 disabled:opacity-50"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              setPendingSide("yes");
            }}
            className="rounded border border-accent bg-accent px-2 py-1.5 text-[12px] font-semibold text-[#05100d] transition-opacity hover:opacity-90"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              setPendingSide("no");
            }}
            className="rounded border border-foreground/25 bg-transparent px-2 py-1.5 text-[12px] font-medium text-foreground/70 transition-colors hover:border-foreground/45 hover:text-foreground"
          >
            No
          </button>
        </div>
      )}

      {feedback && (
        <span className={`text-[10.5px] leading-snug ${feedback.ok ? "text-accent" : "text-foreground/50"}`}>
          {feedback.message}
        </span>
      )}
    </div>
  );
}
