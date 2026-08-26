"use client";

/**
 * App-wide wallet state. Client-only by construction ("use client" plus
 * every operation touching browser-only APIs -- IndexedDB, localStorage,
 * WebSocket) -- must never be imported into a server component or it
 * breaks the static-export prerender (see docs/architecture.md's
 * "Hosting: GitHub Pages via Actions" section on output: "export").
 *
 * Deliberately does NOT expose the mnemonic or keyring outside this
 * module once creation/restore is done -- components read `address`
 * and `balance`, and call `placeStake` for the one thing that actually
 * needs to sign something. placeStake re-derives the keyring from the
 * cached mnemonic on demand rather than holding it in React state for
 * the component's whole lifetime -- it exists only for the duration of
 * that one signing call, same lifetime the mnemonic itself has during
 * createWallet/restoreWallet above.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { cacheWallet, loadCachedWallet, clearCachedWallet } from "./walletCache";
import { downloadSeedPhrase } from "./walletDownload";
import type { Side, StakeResult } from "./stake";
// `./keyring` and `./api` both import @gear-js/api, which bundles
// @polkadot/api's full RPC/metadata client alongside the (much
// smaller) keyring pieces this feature actually needs most of the
// time -- confirmed by measuring the built chunk sizes before/after
// this split (du -sh web/out/_next/static/chunks/*), not assumed.
// Dynamically imported inside the functions that need them rather
// than statically here, so a visitor who never touches the wallet UI
// never downloads any of it -- see mnemonicValidate.ts for the one
// piece (BIP39 checksum, for live input feedback) that's cheap enough
// and needed early enough to stay a static import.

type WalletStatus = "loading" | "none" | "ready";

interface WalletState {
  status: WalletStatus;
  address: string | null;
  balance: string | null;
  balanceError: string | null;
  /** Set immediately after createWallet() so the UI can show the "save this" moment once. */
  justCreated: boolean;
  createWallet: () => Promise<void>;
  restoreWallet: (mnemonic: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
  refreshBalance: () => Promise<void>;
  dismissJustCreated: () => void;
  placeStake: (args: {
    playerId: number;
    gw: number;
    threshold: number;
    side: Side;
    amountVara: string;
  }) => Promise<StakeResult>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>("loading");
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState(false);

  const fetchBalance = useCallback(async (addr: string) => {
    try {
      const { getBalance } = await import("./api");
      const b = await getBalance(addr);
      setBalance(b);
      setBalanceError(null);
    } catch (err) {
      console.error("Failed to fetch VARA balance:", err);
      setBalanceError("Couldn't reach Vara mainnet");
    }
  }, []);

  // On mount: restore a cached wallet for this browser profile, if any.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadCachedWallet();
      if (cancelled) return;
      if (cached) {
        setAddress(cached.address);
        setStatus("ready");
        void fetchBalance(cached.address);
      } else {
        setStatus("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchBalance]);

  const createWallet = useCallback(async () => {
    const { generateWallet } = await import("./keyring");
    const wallet = await generateWallet();
    downloadSeedPhrase(wallet.address, wallet.mnemonic);
    await cacheWallet(wallet.address, wallet.mnemonic);
    setAddress(wallet.address);
    setStatus("ready");
    setJustCreated(true);
    void fetchBalance(wallet.address);
  }, [fetchBalance]);

  const restoreWallet = useCallback(
    async (mnemonic: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const { restoreWalletFromMnemonic } = await import("./keyring");
        const wallet = await restoreWalletFromMnemonic(mnemonic);
        await cacheWallet(wallet.address, wallet.mnemonic);
        setAddress(wallet.address);
        setStatus("ready");
        void fetchBalance(wallet.address);
        return { ok: true };
      } catch {
        return { ok: false, error: "That doesn't look like a valid seed phrase." };
      }
    },
    [fetchBalance],
  );

  const logout = useCallback(() => {
    clearCachedWallet();
    setAddress(null);
    setBalance(null);
    setBalanceError(null);
    setJustCreated(false);
    setStatus("none");
  }, []);

  const refreshBalance = useCallback(async () => {
    if (address) await fetchBalance(address);
  }, [address, fetchBalance]);

  const dismissJustCreated = useCallback(() => setJustCreated(false), []);

  const placeStake = useCallback(
    async (args: {
      playerId: number;
      gw: number;
      threshold: number;
      side: Side;
      amountVara: string;
    }): Promise<StakeResult> => {
      if (!address) return { ok: false, error: "not_connected" };
      const faucetUrl = process.env.NEXT_PUBLIC_FAUCET_URL;
      if (!faucetUrl) return { ok: false, error: "not_configured" };

      const cached = await loadCachedWallet();
      if (!cached) return { ok: false, error: "wallet_locked" };

      const [{ restoreWalletFromMnemonic }, { placeStake: signAndSubmitStake }] = await Promise.all([
        import("./keyring"),
        import("./stake"),
      ]);
      // Re-derives the keyring for this call only -- see the module
      // docstring above for why this isn't kept around in state.
      const wallet = await restoreWalletFromMnemonic(cached.mnemonic);
      const result = await signAndSubmitStake({ keyring: wallet.keyring, faucetUrl, ...args });
      void fetchBalance(address); // a successful stake just moved this wallet's balance
      return result;
    },
    [address, fetchBalance],
  );

  const value = useMemo(
    () => ({
      status,
      address,
      balance,
      balanceError,
      justCreated,
      createWallet,
      restoreWallet,
      logout,
      refreshBalance,
      dismissJustCreated,
      placeStake,
    }),
    [
      status,
      address,
      balance,
      balanceError,
      justCreated,
      createWallet,
      restoreWallet,
      logout,
      refreshBalance,
      dismissJustCreated,
      placeStake,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
