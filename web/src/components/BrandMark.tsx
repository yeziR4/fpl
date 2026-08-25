export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 46 46" fill="none" className={className} aria-hidden="true">
      <circle
        cx="23"
        cy="23"
        r="18"
        stroke="var(--accent)"
        strokeWidth="4"
        strokeDasharray="10 6.2"
        transform="rotate(-14 23 23)"
      />
      <circle cx="23" cy="23" r="5.5" fill="var(--accent)" />
    </svg>
  );
}
