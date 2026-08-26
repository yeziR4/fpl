import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { VaraWordmark } from "@/components/VaraWordmark";
import { WalletButton } from "@/components/WalletButton";

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
          <div className="hidden items-center gap-1.5 rounded-full border border-foreground/18 px-3.5 py-1.5 sm:flex">
            <VaraWordmark className="text-[13px] text-foreground" />
            <span className="text-[11px] font-medium tracking-[0.03em] text-foreground/55">
              Network
            </span>
          </div>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
