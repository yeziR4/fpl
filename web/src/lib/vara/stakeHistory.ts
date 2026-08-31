/**
 * "My stakes" -- a local record of what this wallet has staked on,
 * kept for exactly the same reason the wallet cache exists
 * (walletCache.ts): a convenience view for a returning visitor on the
 * same browser, not a source of truth. The stake itself is always
 * real and recorded on-chain + in MarketLedger's own storage
 * regardless of this; losing this local list loses the convenient
 * "what did I bet on" view, never the stake itself.
 *
 * Deliberately NOT encrypted the way the cached mnemonic is -- a
 * stake record (which player, which side, how much) isn't a secret,
 * there's nothing here an attacker could spend from.
 */

import type { Side } from "./stake";

export interface StakeHistoryEntry {
  txHash: string;
  playerId: number;
  playerName: string;
  gw: number;
  threshold: number;
  /** e.g. "Over 5 pts" -- kept alongside threshold so the list reads
   * naturally without re-deriving the label from a number. */
  label: string;
  side: Side;
  amountVara: string;
  stakedAt: number;
}

const STORAGE_KEY = "vara-stake-history";
const MAX_ENTRIES = 100;

/** Fired on window after a stake is recorded -- lets a persistently-
 * mounted component (OnboardingGuide's "place your first bet" step)
 * react to a new stake without polling or remounting. Not a storage
 * event: those only fire in *other* tabs, never the tab that made the
 * write. */
export const STAKE_HISTORY_CHANGED_EVENT = "stake-history-changed";

export function recordStake(entry: StakeHistoryEntry): void {
  const existing = loadStakeHistory();
  const updated = [entry, ...existing].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage full or unavailable (private browsing, etc) -- the
    // stake itself already succeeded, losing this local record isn't
    // worth surfacing an error over.
  }
  window.dispatchEvent(new Event(STAKE_HISTORY_CHANGED_EVENT));
}

/** Newest first. Returns an empty list on any failure -- a private
 * window or storage that's been cleared just shows no history, not
 * an error. */
export function loadStakeHistory(): StakeHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
