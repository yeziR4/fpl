"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@/lib/vara/WalletProvider";
import { isValidMnemonic } from "@/lib/vara/mnemonicValidate";
import { claimFaucet, faucetErrorMessage, isFaucetConfigured } from "@/lib/vara/faucet";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Closes a dropdown on an outside click, via a document-level listener
 * rather than a full-screen `fixed inset-0` backdrop div -- the latter
 * breaks here because Header's `backdrop-blur-sm` makes it a
 * containing block for `position: fixed` descendants, clipping such a
 * backdrop to the header bar's own height instead of the viewport (see
 * RestoreModal's portal for the same underlying issue, fixed there by
 * escaping the DOM subtree instead).
 */
function useOutsideClick(ref: RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref, onOutside]);
}

export function WalletButton() {
  const wallet = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  if (wallet.status === "loading") {
    return (
      <div className="h-[38px] w-[132px] animate-pulse rounded-md bg-foreground/10" aria-hidden="true" />
    );
  }

  if (wallet.status === "none") {
    return (
      <>
        <button
          type="button"
          onClick={() => void wallet.createWallet()}
          className="rounded-md bg-accent px-4.5 py-2 font-sans text-[14px] font-semibold text-[#05100d] transition-opacity hover:opacity-90"
        >
          Create Wallet
        </button>
        <button
          type="button"
          onClick={() => setRestoreOpen(true)}
          className="ml-2 hidden text-[12.5px] font-medium text-foreground/50 underline decoration-foreground/25 underline-offset-2 hover:text-foreground/75 sm:inline"
        >
          Restore
        </button>
        {restoreOpen && <RestoreModal onClose={() => setRestoreOpen(false)} />}
      </>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-foreground/18 bg-white/[0.03] px-3.5 py-2 font-sans text-[13.5px] font-medium text-foreground transition-colors hover:border-accent/50"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
        {wallet.address && shortAddress(wallet.address)}
        <span className="text-foreground/40">
          {wallet.balance !== null ? `${wallet.balance} VARA` : wallet.balanceError ? "—" : "…"}
        </span>
      </button>

      {menuOpen && (
        <WalletMenu
          onClose={() => setMenuOpen(false)}
          onLoggedOut={() => setMenuOpen(false)}
        />
      )}

      {wallet.justCreated && <CreatedNotice onDismiss={wallet.dismissJustCreated} />}
    </div>
  );
}

function WalletMenu({ onClose, onLoggedOut }: { onClose: () => void; onLoggedOut: () => void }) {
  const wallet = useWallet();
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref, onClose);

  async function copyAddress() {
    if (!wallet.address) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }


  return (
    <div
      ref={ref}
      className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 rounded-lg border border-foreground/12 bg-background p-3.5 shadow-[0_18px_40px_rgba(0,0,0,0.5)]"
    >
      <div className="mb-3 flex flex-col gap-1">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground/40">
          Wallet address
        </span>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[12.5px] text-foreground/80">{wallet.address}</span>
          <button
            type="button"
            onClick={copyAddress}
            className="shrink-0 text-[11.5px] font-medium text-accent hover:opacity-80"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-1 border-t border-foreground/10 pt-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground/40">
          Balance
        </span>
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-lg font-black text-foreground">
            {wallet.balance !== null ? `${wallet.balance} VARA` : wallet.balanceError ?? "Loading…"}
          </span>
          <button
            type="button"
            onClick={() => void wallet.refreshBalance()}
            className="text-[11.5px] font-medium text-foreground/50 hover:text-foreground/80"
          >
            Refresh
          </button>
        </div>
      </div>

      {isFaucetConfigured() && wallet.address && (
        <FaucetClaimSection address={wallet.address} onClaimed={() => void wallet.refreshBalance()} />
      )}

      <p className="mb-3 border-t border-foreground/10 pt-3 text-[11px] leading-relaxed text-foreground/40">
        Your seed phrase downloaded when this wallet was created. We never stored it and can&rsquo;t show
        it again — keep that file safe, it&rsquo;s the only way back in on a new browser.
      </p>

      <button
        type="button"
        onClick={() => {
          wallet.logout();
          onLoggedOut();
        }}
        className="w-full rounded border border-foreground/18 py-1.5 text-[12.5px] font-medium text-foreground/70 transition-colors hover:border-red-400/40 hover:text-red-300"
      >
        Log out on this browser
      </button>
    </div>
  );
}

/**
 * Demo-only: claims a small amount of VARA from the project's own
 * faucet (faucet/ at the repo root, a Cloudflare Worker -- see
 * docs/architecture.md), not Gear's official mainnet faucet. Each
 * wallet can claim once, enforced server-side by the Worker itself --
 * this component just calls it and shows the result, it isn't the
 * source of truth on eligibility.
 */
function FaucetClaimSection({ address, onClaimed }: { address: string; onClaimed: () => void }) {
  const [state, setState] = useState<
    { status: "idle" } | { status: "claiming" } | { status: "done"; message: string; ok: boolean }
  >({ status: "idle" });

  async function claim() {
    setState({ status: "claiming" });
    const result = await claimFaucet(address);
    if (result.ok) {
      setState({ status: "done", ok: true, message: `Sent ${result.amount} VARA` });
      onClaimed();
    } else {
      setState({ status: "done", ok: false, message: faucetErrorMessage(result.error) });
    }
  }

  return (
    <div className="mb-3 flex flex-col gap-1.5 border-t border-foreground/10 pt-3">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground/40">
        Demo faucet
      </span>
      {state.status === "done" ? (
        <p className={`text-[12px] font-medium ${state.ok ? "text-accent" : "text-foreground/50"}`}>
          {state.message}
        </p>
      ) : (
        <button
          type="button"
          disabled={state.status === "claiming"}
          onClick={() => void claim()}
          className="w-full rounded border border-accent/50 py-1.5 text-[12.5px] font-medium text-accent transition-colors hover:border-accent disabled:opacity-50"
        >
          {state.status === "claiming" ? "Claiming…" : "Claim demo VARA"}
        </button>
      )}
    </div>
  );
}

function CreatedNotice({ onDismiss }: { onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref, onDismiss);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-[calc(100%+8px)] z-50 w-80 rounded-lg border border-accent/40 bg-background p-4 shadow-[0_18px_40px_rgba(0,0,0,0.5)]"
    >
      <span className="font-display text-base font-black uppercase text-accent">Wallet created</span>
      <p className="mt-2 text-[12.5px] leading-relaxed text-foreground/65">
        Your seed phrase just downloaded as a .txt file. That&rsquo;s the only copy — save it somewhere
        safe. Anyone with that phrase can spend everything in this wallet, and we can&rsquo;t recover it
        for you if it&rsquo;s lost.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 w-full rounded bg-accent py-1.5 text-[12.5px] font-semibold text-[#05100d] hover:opacity-90"
      >
        Got it
      </button>
    </div>
  );
}

function RestoreModal({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const [mnemonic, setMnemonic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const looksValid = isValidMnemonic(mnemonic);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await wallet.restoreWallet(mnemonic);
    setBusy(false);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error);
    }
  }

  // Portal to document.body: Header's backdrop-blur-sm establishes a
  // containing block for position:fixed descendants (a CSS quirk of
  // filter/backdrop-filter, confirmed by inspecting the rendered
  // bounding box -- without this the modal was clipped to the header
  // bar's own ~69px height instead of covering the viewport). Escaping
  // the header's DOM subtree via a portal sidesteps that entirely.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-foreground/15 bg-background p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="font-display text-lg font-black uppercase text-foreground">Restore wallet</span>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/50">
          Paste the seed phrase from your downloaded backup file.
        </p>
        <textarea
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          rows={3}
          placeholder="word word word ..."
          className="mt-3 w-full resize-none rounded-md border border-foreground/18 bg-white/[0.03] p-2.5 font-mono text-[12.5px] text-foreground outline-none focus:border-accent/60"
        />
        {!looksValid && mnemonic.trim().length > 0 && (
          <p className="mt-2 text-[12px] text-foreground/40">
            Doesn&rsquo;t look like a complete seed phrase yet.
          </p>
        )}
        {error && <p className="mt-2 text-[12px] text-red-300">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-foreground/18 py-2 text-[13px] font-medium text-foreground/70 hover:border-foreground/35"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !looksValid}
            onClick={() => void submit()}
            className="flex-1 rounded bg-accent py-2 text-[13px] font-semibold text-[#05100d] hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Restoring…" : "Restore"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
