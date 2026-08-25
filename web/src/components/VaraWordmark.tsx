/**
 * "VARA" as styled text, not an image.
 *
 * The user shared Vara's actual logo file for this, but it's a small
 * (139x91px) screenshot-style crop with an opaque dark background baked
 * in (~#18181b/#19251d, confirmed by sampling corner pixels) rather
 * than a transparent press-kit asset -- dropped in as-is it would show
 * as a mismatched rectangle against this site's own background
 * (#05080a). Vara does publish real logo files at vara.network/press-kit,
 * but that domain isn't reachable from here to fetch them.
 *
 * This recreates the wordmark as text in the site's own display font
 * (Big Shoulders -- already loaded for every heading on the site) at
 * a bold enough weight to match the reference's visual weight. It
 * scales cleanly at any size and never mismatches the page background,
 * unlike the raster crop. Swap this out for the real press-kit SVG/PNG
 * whenever one with a transparent background is available.
 */
export function VaraWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-black uppercase leading-none tracking-[0.01em] ${className}`}>
      Vara
    </span>
  );
}
