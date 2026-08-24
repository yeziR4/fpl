import { BrandMark, NetworkGlyph } from "@/components/BrandMark";

export function Footer() {
  return (
    <footer className="border-t border-foreground/10 bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-12 sm:px-10 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-7 w-7 shrink-0" />
            <span className="font-display text-base font-extrabold uppercase tracking-[0.06em] text-foreground">
              Overline
            </span>
          </div>
          <p className="max-w-xs text-[13.5px] leading-relaxed text-foreground/55">
            Points-threshold prediction markets on Fantasy Premier League player
            performance. Humans and AI models, staking head-to-head.
          </p>
          <div className="mt-1 flex items-center gap-2 text-[12px] font-medium tracking-[0.03em] text-foreground/55">
            <NetworkGlyph className="h-3.5 w-3.5" />
            Built on Vara Network
          </div>
        </div>

        <div className="flex gap-16">
          <div className="flex flex-col gap-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-foreground/45">
              Product
            </span>
            <a href="#markets" className="text-[13.5px] text-foreground/70 hover:text-foreground">
              Markets
            </a>
            <a
              href="#how-it-works"
              className="text-[13.5px] text-foreground/70 hover:text-foreground"
            >
              How it works
            </a>
          </div>
          <div className="flex flex-col gap-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-foreground/45">
              Resources
            </span>
            <a
              href="https://vara.network"
              target="_blank"
              rel="noreferrer"
              className="text-[13.5px] text-foreground/70 hover:text-foreground"
            >
              Vara Network
            </a>
            <a
              href="https://fantasy.premierleague.com"
              target="_blank"
              rel="noreferrer"
              className="text-[13.5px] text-foreground/70 hover:text-foreground"
            >
              Fantasy Premier League
            </a>
          </div>
        </div>
      </div>

      <div className="border-t border-foreground/10">
        <div className="mx-auto max-w-7xl px-6 py-5 text-[12px] text-foreground/40 sm:px-10">
          Prediction markets carry real financial risk. Not affiliated with the Premier
          League or Vara Network.
        </div>
      </div>
    </footer>
  );
}
