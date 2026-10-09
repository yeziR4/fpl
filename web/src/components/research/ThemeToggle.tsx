"use client";

/**
 * Light / dark toggle.
 *
 * Three states, not two: follow the system, force light, force dark. A two-state
 * toggle silently overrides the reader's OS setting the first time they touch
 * it, and then they cannot get back to following it.
 *
 * The class lands on <html> so every CSS variable flips at once. `documentElement`
 * is also what the pre-paint script in layout.tsx writes, so the two agree.
 */

import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";
const STORAGE_KEY = "overline-theme";

/** Must match the pre-paint script in app/layout.tsx. */
function apply(mode: Mode): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (mode === "light" || mode === "dark") root.classList.add(mode);
  try {
    if (mode === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private browsing, or storage disabled. The class still applied; the
    // choice just will not survive a reload, which is a tolerable failure.
  }
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    setMode(stored === "light" || stored === "dark" ? stored : "system");
    setMounted(true);
  }, []);

  const options: { value: Mode; label: string }[] = [
    { value: "system", label: "Auto" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  return (
    <div
      className="inline-flex items-center rounded-full border border-hairline p-0.5"
      role="group"
      aria-label="Colour theme"
    >
      {options.map((option) => {
        // Before mount everything renders as unselected, so the server HTML and
        // the first client paint match and React does not warn.
        const active = mounted && mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setMode(option.value);
              apply(option.value);
            }}
            aria-pressed={active}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors ${
              active ? "bg-accent/15 text-accent" : "text-foreground/45 hover:text-foreground/75"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
