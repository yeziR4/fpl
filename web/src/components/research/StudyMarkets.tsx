import { StudyMarketCard } from "@/components/research/MarketCard";
import { ALL_MARKETS, STUDY } from "@/lib/study";

/**
 * The markets this study is running on.
 *
 * A SERVER COMPONENT READING THE BUILD, not a live fetch, and that is the fix
 * for a real mistake. The first version called the API from the browser and
 * rendered a big "Market service unreachable" panel whenever the signer service
 * was not running -- which on a static export is whenever nobody has started it.
 * A research page that shows an error where its evidence should be is worse than
 * one showing slightly stale prices.
 *
 * So the markets come from the committed registry, which cannot fail, and each
 * one links to Panta where the live price and the order book actually are. We are
 * not rebuilding their trading UI; we are pointing at it.
 *
 * Volume is the study's own committed capital, summed from the fills, not the
 * pool total. Calling our own money "volume" would overstate what this shows.
 */

export function StudyMarkets() {
  const committedByMarket = new Map<string, number>();
  for (const f of STUDY.forecasts) {
    if (f.status !== "placed") continue;
    committedByMarket.set(
      f.market.marketId,
      (committedByMarket.get(f.market.marketId) ?? 0) + (f.stakeUsdc ?? 0),
    );
  }

  const positionsByMarket = new Map<string, number>();
  for (const f of STUDY.forecasts) {
    if (f.status !== "placed") continue;
    positionsByMarket.set(f.market.marketId, (positionsByMarket.get(f.market.marketId) ?? 0) + 1);
  }

  return (
    <section id="markets" className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-6 py-16 sm:px-10">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">
          Where the money is
        </span>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-black uppercase leading-[1.02] text-foreground sm:text-4xl">
          Every market, and where to trade it
        </h2>
        <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-foreground/60">
          We do not take bets and we do not hold anything. Each market below is live on Panta, on
          Solana, and settles against the official FPL data. The price and the order book live
          there, not here.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_MARKETS.map((m) => (
            <StudyMarketCard
              key={m.marketId}
              market={m}
              positions={positionsByMarket.get(m.marketId) ?? 0}
              committed={committedByMarket.get(m.marketId) ?? 0}
            />
          ))}
        </div>

        <p className="mt-5 text-[12.5px] text-foreground/40">
          {ALL_MARKETS.length} market{ALL_MARKETS.length === 1 ? "" : "s"} this gameweek. Prices are
          on Panta and move with the crowd — nothing on this page is a quote.
        </p>
      </div>
    </section>
  );
}
