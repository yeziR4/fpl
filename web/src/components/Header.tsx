import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { AccountButton } from "@/components/AccountButton";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4 sm:px-10">
        <Link href="/" className="flex items-center gap-3">
          <BrandMark className="h-8 w-8 shrink-0" />
          <span className="font-display text-lg font-extrabold uppercase tracking-[0.06em] text-foreground">
            Overline
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {/* Root-relative hashes via next/link, not a bare "#markets" --
              now that /leaderboard exists, a same-page anchor would silently
              do nothing from there. next/link also applies basePath, which a
              plain <a href="/#markets"> wouldn't on the GitHub Pages build
              (see next.config.ts). */}
          <Link
            href="/#markets"
            className="text-[14px] font-medium text-foreground/75 hover:text-foreground"
          >
            Markets
          </Link>
          <Link
            href="/#how-it-works"
            className="text-[14px] font-medium text-foreground/75 hover:text-foreground"
          >
            How it works
          </Link>
          <Link
            href="/leaderboard"
            className="text-[14px] font-medium text-foreground/75 hover:text-foreground"
          >
            Leaderboard
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden rounded-full border border-accent/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-accent sm:block">Free to play</div>
          <AccountButton />
        </div>
      </div>
    </header>
  );
}
