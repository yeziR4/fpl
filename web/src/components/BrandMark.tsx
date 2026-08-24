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

export function NetworkGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="3" cy="12.5" r="2" fill="var(--accent)" />
      <circle cx="8" cy="3.5" r="2" fill="var(--accent)" />
      <circle cx="13" cy="12.5" r="2" fill="var(--accent)" />
      <path
        d="M4.6 11.2L7 5.4M9 5.4L11.4 11.2"
        stroke="var(--accent)"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
