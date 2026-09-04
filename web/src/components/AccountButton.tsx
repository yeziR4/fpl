"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useGame } from "@/lib/game/GameProvider";

export function AccountButton() {
  const game = useGame();
  const [open, setOpen] = useState(false);
  const [create, setCreate] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (game.loading) return <span className="text-xs text-foreground/40">Loading…</span>;
  if (game.user) {
    return (
      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <div className="text-xs font-semibold text-foreground">@{game.user.username}</div>
          <div className="text-[10px] text-accent">{game.user.balance.toFixed(0)} credits</div>
        </div>
        <button type="button" onClick={() => void game.logout()} className="rounded-md border border-foreground/20 px-3 py-2 text-xs font-semibold hover:border-foreground/40">
          Sign out
        </button>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const message = await game.login(username, password, create);
    setBusy(false);
    if (message) setError(message);
    else setOpen(false);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md bg-accent px-4 py-2 text-xs font-bold text-[#05100d] hover:opacity-90">
        Sign in to play
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-foreground/15 bg-[#09110f] p-6 shadow-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Overline account</div>
            <h2 className="mt-2 font-display text-3xl font-black uppercase">{create ? "Join the league" : "Welcome back"}</h2>
            <p className="mt-2 text-sm text-foreground/55">Free to play. New players receive 1,000 virtual credits.</p>
            <label className="mt-5 block text-xs font-semibold text-foreground/60">Username</label>
            <input required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className="mt-1.5 w-full rounded-md border border-foreground/20 bg-white/[0.04] px-3 py-2.5 outline-none focus:border-accent" />
            <label className="mt-4 block text-xs font-semibold text-foreground/60">Password</label>
            <input required minLength={8} type="password" autoComplete={create ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 w-full rounded-md border border-foreground/20 bg-white/[0.04] px-3 py-2.5 outline-none focus:border-accent" />
            {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
            <button disabled={busy} className="mt-5 w-full rounded-md bg-accent py-3 text-sm font-bold text-[#05100d] disabled:opacity-50">{busy ? "Please wait…" : create ? "Create account" : "Sign in"}</button>
            <button type="button" onClick={() => { setCreate(!create); setError(null); }} className="mt-4 w-full text-xs text-foreground/55 hover:text-foreground">
              {create ? "Already playing? Sign in" : "New here? Create an account"}
            </button>
          </form>
        </div>,
        document.body,
      )}
    </>
  );
}
