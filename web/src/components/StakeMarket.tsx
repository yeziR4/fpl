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
 *
 * The amount input is dollar-first, VARA second (once a live price is
 * available -- see lib/vara/price.ts): typing "10" means $10, with the
 * real VARA amount that actually gets signed and transferred shown
 * underneath as the secondary figure. Requested directly after this
 * read backwards ("I press 10 and it's 10 VARA, the price in $ is
 * shown below") -- VARA is still the only unit that ever actually
 * moves (see confirmStake), this only changes which figure a person
 * types into.
 *
 * "Potential winnings" is a live estimate, computed with the exact
 * same parimutuel formula MarketLedger.ts's settle handler actually
 * pays out with (amount * totalPool / winningSideTotal), projected
 * onto the CURRENT totals plus this hypothetical stake -- clearly
 * labeled "if it resolved right now", since more stakes arriving
 * before the real settlement changes the real payout. Not a promise,
 * an honest best-current-estimate.
 */

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/vara/WalletProvider";
import type { AgentPickCounts } from "@/lib/agentPicks";
import { fetchMarketTotals, stakeErrorMessage, type MarketTotals, type Side } from "@/lib/vara/stake";
import { useVaraUsdPrice } from "@/lib/vara/useVaraUsdPrice";
import { formatUsd, usdToVara } from "@/lib/vara/price";

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
  const priceUsd = useVaraUsdPrice();
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

  // The input is dollar-denominated whenever a live price is known --
  // `amount` holds whatever the person typed under that label. Falls
  // back to VARA-denominated (amount used as-is) if the price feed is
  // ever unavailable, the same fail-soft contract price.ts follows
  // everywhere else -- staking still works, it just can't offer the $
  // framing without a real rate to convert through.
  const amountIsUsd = priceUsd !== null;
  const effectiveAmountVara = amountIsUsd ? (usdToVara(amount, priceUsd) ?? "0") : amount;

  async function confirmStake(side: Side) {
    if (gw === null) return;
    if (wallet.status !== "ready") {
      setFeedback({ ok: false, message: "Create a wallet first." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await wallet.placeStake({
      playerId,
      playerName,
      gw,
      threshold,
      label,
      side,
      amountVara: effectiveAmountVara,
    });
    setBusy(false);
    if (result.ok) {
      setTotals({ yes: result.yes, no: result.no, yesCount: result.yesCount, noCount: result.noCount });
      setPendingSide(null);
      const sideLabel = side === "yes" ? "Yes" : "No";
      setFeedback({
        ok: true,
        message: amountIsUsd
          ? `Staked $${amount} (${effectiveAmountVara} VARA) on ${sideLabel}`
          : `Staked ${amount} VARA on ${sideLabel}`,
      });
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
            {varaStaked > 0 && priceUsd !== null && ` (${formatUsd(varaStaked, priceUsd)})`}
          </span>
        </>
      )}

      {!marketOpen ? (
        <span className="text-[11px] text-foreground/35">
          {gw === null ? "No fixture this gameweek" : "Staking isn't open yet"}
        </span>
      ) : pendingSide ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <div className="flex flex-col">
              <div className="relative">
                {amountIsUsd && (
                  <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[11.5px] text-foreground/40">
                    $
                  </span>
                )}
                <input
                  type="number"
                  min="0.01"
                  step="0.1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-label={amountIsUsd ? "Stake amount in USD" : "Stake amount in VARA"}
                  className={`w-16 rounded border border-foreground/20 bg-white/[0.03] py-1.5 text-[11.5px] text-foreground outline-none focus:border-accent/60 ${amountIsUsd ? "pl-3.5 pr-1.5" : "px-1.5"}`}
                />
              </div>
              {amountIsUsd && (
                <span className="mt-0.5 text-center text-[9.5px] text-foreground/35">
                  {effectiveAmountVara} VARA
                </span>
              )}
            </div>
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

          <PotentialWinnings
            side={pendingSide}
            stakeVara={Number(effectiveAmountVara)}
            varaYes={varaYes}
            varaNo={varaNo}
            priceUsd={priceUsd}
          />
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

/**
 * "If this side wins, right now, you'd get back roughly X" -- the
 * exact parimutuel formula MarketLedger.ts's settle handler actually
 * pays out with (amount * totalPool / winningSideTotal), projected
 * onto the current totals plus this hypothetical stake. Always an
 * estimate, never a promise: more stakes landing before real
 * settlement moves the real payout, which is why this is worded "if
 * it resolved right now" rather than a bare number.
 */
function PotentialWinnings({
  side,
  stakeVara,
  varaYes,
  varaNo,
  priceUsd,
}: {
  side: Side;
  stakeVara: number;
  varaYes: number;
  varaNo: number;
  priceUsd: number | null;
}) {
  if (!Number.isFinite(stakeVara) || stakeVara <= 0) return null;

  const currentSideTotal = side === "yes" ? varaYes : varaNo;
  const newSideTotal = currentSideTotal + stakeVara;
  const newTotalPool = varaYes + varaNo + stakeVara;
  const winningsVara = (stakeVara * newTotalPool) / newSideTotal;

  return (
    <span className="text-[10.5px] leading-snug text-foreground/45">
      If {side === "yes" ? "Yes" : "No"} wins right now, you&rsquo;d get back{" "}
      <span className="font-semibold text-accent">
        {winningsVara.toFixed(4)} VARA
        {priceUsd !== null && ` (${formatUsd(winningsVara, priceUsd)})`}
      </span>{" "}
      -- estimate, moves as more people stake.
    </span>
  );
}
