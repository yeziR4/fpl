"use client";

import { useEffect, useRef, useState } from "react";

interface StatCountUpProps {
  value: number;
  durationMs?: number;
}

/**
 * A number that rolls up from 0 to `value` the moment it scrolls into
 * view -- the broadcast-graphic effect the user asked for ("every
 * Premier League game has these animations"), built on real
 * season-to-date stats (points/goals/assists) already in the
 * bootstrap-static snapshot, not licensed video. Runs once per mount
 * (a card scrolling in and out repeatedly doesn't re-trigger it).
 *
 * Respects prefers-reduced-motion: jumps straight to the final value
 * instead of animating, same as any well-behaved motion-design.
 */
export function StatCountUp({ value, durationMs = 900 }: StatCountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  // Lazy initializer, not an effect -- reduced-motion viewers see the
  // final value on first paint instead of a state update right after.
  const [display, setDisplay] = useState(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? value
      : 0,
  );
  const started = useRef(false);

  useEffect(() => {
    if (display === value) return; // reduced-motion case: nothing to animate
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started.current) {
            started.current = true;
            runCountUp(value, durationMs, setDisplay);
          }
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately runs once per mount
  }, []);

  return <span ref={ref}>{display}</span>;
}

function runCountUp(target: number, durationMs: number, setDisplay: (n: number) => void) {
  const start = performance.now();
  function tick(now: number) {
    const progress = Math.min((now - start) / durationMs, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic -- fast start, settles gently
    setDisplay(Math.round(eased * target));
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
