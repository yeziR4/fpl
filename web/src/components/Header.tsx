import Link from "next/link";
import { BrandMark, NetworkGlyph } from "@/components/BrandMark";

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
          <a href="#markets" className="text-[14px] font-medium text-foreground/75 hover:text-foreground">
            Markets
          </a>
          <a
            href="#how-it-works"
            className="text-[14px] font-medium text-foreground/75 hover:text-foreground"
          >
            How it works
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-foreground/18 px-3.5 py-1.5 sm:flex">
            <NetworkGlyph className="h-3.5 w-3.5" />
            <span className="text-[11.5px] font-medium tracking-[0.03em] text-foreground/75">
              Vara Network
            </span>
          </div>
          <button className="rounded-md bg-accent px-4.5 py-2 font-sans text-[14px] font-semibold text-[#05100d] transition-opacity hover:opacity-90">
            Connect Wallet
          </button>
        </div>
      </div>
    </header>
  );
}
