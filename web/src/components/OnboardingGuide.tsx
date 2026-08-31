"use client";

/**
 * A 3-step walkthrough for a first-time visitor: create a wallet, claim
 * demo VARA, place a first bet. Requested directly after a real first
 * user liked the UI but "struggled to understand the app" -- everything
 * needed (wallet button in the header, faucet claim buried in its
 * dropdown, staking buttons on each market card) already existed, just
 * not narrated anywhere as a single path to a first bet. This is that
 * narration, not new functionality: every action here calls the exact
 * same wallet/faucet code the header button and market cards already
 * use (useWallet, claimFaucet) -- see WalletButton.tsx and
 * StakeMarket.tsx for the "normal" entry points to the same calls.
 *
 * Each step's completion is read from real state, not tracked
 * separately, so it can't drift out of sync with what actually
 * happened:
 *   1. wallet created  -- wallet.status === "ready"
 *   2. VARA claimed    -- wallet.balance is a positive number
 *   3. first bet placed -- stakeHistory has at least one entry
 *
 * Dismissible (localStorage flag, this browser only) and not shown
 * again once dismissed, same convenience-not-source-of-truth pattern
 * as stakeHistory.ts/walletCache.ts. Placed between Hero and
 * MarketsSection in page.tsx.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useWallet } from "@/lib/vara/WalletProvider";
import { claimFaucet, faucetErrorMessage, isFaucetConfigured } from "@/lib/vara/faucet";
import { loadStakeHistory, STAKE_HISTORY_CHANGED_EVENT } from "@/lib/vara/stakeHistory";

const DISMISSED_KEY = "onboarding-dismissed";

function loadDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Storage unavailable -- worst case the guide reappears next visit.
  }
}

export function OnboardingGuide() {
  const wallet = useWallet();
  // Lazy initializers, not an effect -- both localStorage reads are
  // client-only, guarded the same way StatCountUp guards its own
  // client-only initial value. Server (and the static-export
  // prerender) always sees the "not decided yet" / "nothing staked"
  // defaults; a real browser fills in the true values on first render.
  const [dismissed, setDismissed] = useState<boolean | null>(() =>
    typeof window !== "undefined" ? loadDismissed() : null,
  );
  const [hasStaked, setHasStaked] = useState(() =>
    typeof window !== "undefined" ? loadStakeHistory().length > 0 : false,
  );
  const [faucetState, setFaucetState] = useState<
    { status: "idle" } | { status: "claiming" } | { status: "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    const onChange = () => setHasStaked(loadStakeHistory().length > 0);
    window.addEventListener(STAKE_HISTORY_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(STAKE_HISTORY_CHANGED_EVENT, onChange);
  }, []);

  const dismiss = useCallback(() => {
    saveDismissed();
    setDismissed(true);
  }, []);

  // Not decided yet (still reading localStorage) or the visitor already
  // dismissed it, on this browser, at any point -- including having
  // finished all three steps previously.
  if (dismissed !== false) return null;
  // Loading/none are both handled by step 1's own CTA; nothing to
  // gate the whole guide on here.

  const walletReady = wallet.status === "ready";
  const balanceNum = wallet.balance !== null ? Number(wallet.balance) : 0;
  const hasBalance = walletReady && balanceNum > 0;
  const allDone = walletReady && hasBalance && hasStaked;

  async function claim() {
    if (!wallet.address) return;
    setFaucetState({ status: "claiming" });
    const result = await claimFaucet(wallet.address);
    if (result.ok) {
      setFaucetState({ status: "idle" });
      void wallet.refreshBalance();
    } else {
      setFaucetState({ status: "error", message: faucetErrorMessage(result.error) });
    }
  }

  return (
    <section className="border-t border-foreground/10 bg-accent-dim/40">
      <div className="mx-auto max-w-4xl px-6 py-8 sm:px-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              New here?
            </span>
            <h2 className="mt-1 font-display text-xl font-black uppercase leading-none text-foreground sm:text-2xl">
              {allDone ? "You're all set" : "Place your first bet in 3 steps"}
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss guide"
            className="shrink-0 rounded px-1.5 py-1 text-[13px] text-foreground/40 hover:text-foreground/70"
          >
            ✕
          </button>
        </div>

        <ol className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Step
            done={walletReady}
            number={1}
            title="Create a wallet"
            description="Generates a Vara wallet in this browser and downloads your Overline phrase -- keep it safe, it's the only way back in."
          >
            {!walletReady && wallet.status === "none" && (
              <button
                type="button"
                onClick={() => void wallet.createWallet()}
                className="mt-2 w-full rounded bg-accent py-1.5 text-[12px] font-semibold text-[#05100d] transition-opacity hover:opacity-90"
              >
                Create wallet
              </button>
            )}
          </Step>

          <Step
            done={hasBalance}
            number={2}
            title="Claim demo VARA"
            description="Free demo VARA to stake with, from this project's own faucet -- one claim per wallet."
          >
            {walletReady && !hasBalance && isFaucetConfigured() && (
              <button
                type="button"
                disabled={faucetState.status === "claiming"}
                onClick={() => void claim()}
                className="mt-2 w-full rounded border border-accent/50 py-1.5 text-[12px] font-medium text-accent transition-colors hover:border-accent disabled:opacity-50"
              >
                {faucetState.status === "claiming" ? "Claiming…" : "Claim demo VARA"}
              </button>
            )}
            {faucetState.status === "error" && (
              <p className="mt-1.5 text-[11px] text-foreground/50">{faucetState.message}</p>
            )}
          </Step>

          <Step
            done={hasStaked}
            number={3}
            title="Place a bet"
            description="Pick any player card below, then Yes or No on whether they'll clear the points line."
          >
            {walletReady && hasBalance && !hasStaked && (
              <a
                href="#markets"
                className="mt-2 block w-full rounded border border-foreground/25 py-1.5 text-center text-[12px] font-medium text-foreground/70 transition-colors hover:border-foreground/45 hover:text-foreground"
              >
                Browse markets
              </a>
            )}
          </Step>
        </ol>
      </div>
    </section>
  );
}

function Step({
  done,
  number,
  title,
  description,
  children,
}: {
  done: boolean;
  number: number;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col rounded-lg border border-foreground/12 bg-background/60 p-3.5">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            done ? "bg-accent text-[#05100d]" : "border border-foreground/25 text-foreground/50"
          }`}
        >
          {done ? "✓" : number}
        </span>
        <span className={`text-[13px] font-semibold ${done ? "text-foreground/50 line-through" : "text-foreground"}`}>
          {title}
        </span>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground/45">{description}</p>
      {children}
    </li>
  );
}
