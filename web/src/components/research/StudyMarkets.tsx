import { StudyMarketCard } from "@/components/research/MarketCard";
import { ALL_MARKETS, RESULTS_AS_OF, RESOLUTION_TIME, STUDY } from "@/lib/study";

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

  const decidedCount = ALL_MARKETS.filter((m) => m.decided).length;

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

        {/*
          The resolution status, stated plainly, because "has it settled yet" is
          the first thing anyone asks and the honest answer is two-part: the
          real-world event is over and the outcome is fixed, but the on-chain
          market has not been resolved by Panta yet.

          We publish our own computed outcome BEFORE the oracle acts, with its
          timestamp. Our first three markets named two FPL endpoints and one of
          them returns SEASON totals -- an oracle reading that one would resolve
          every market YES. If that happens, this page is the record of what the
          official data said and when we read it.
        */}
        <div className="mt-6 rounded-lg border border-hairline bg-surface p-5">
          <h3 className="mb-2 text-[13px] font-semibold text-foreground">Have these resolved?</h3>
          <p className="max-w-3xl text-[13px] leading-relaxed text-foreground/60">
            {decidedCount > 0 ? (
              <>
                <strong className="font-semibold text-foreground/85">
                  The real-world outcome is known for {decidedCount} of {ALL_MARKETS.length} markets
                </strong>{" "}
                — that player has played, and the line cannot move any further. The on-chain markets
                have <strong className="font-semibold text-foreground/85">not settled yet</strong>:
                Panta resolves them at {RESOLUTION_TIME} and pays out then.
              </>
            ) : (
              <>
                Not yet — none of this gameweek&apos;s players have played. Panta resolves the
                markets at {RESOLUTION_TIME}.
              </>
            )}
          </p>
          <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-foreground/45">
            The outcomes above are ours, computed from the official FPL data{" "}
            {RESULTS_AS_OF ? `on ${RESULTS_AS_OF.slice(0, 16).replace("T", " ")}Z` : "at build time"}{" "}
            and published before Panta&apos;s oracle acts. A market resolves YES if the player
            reached the line, NO otherwise. Nothing here settles anything — the chain does that.
          </p>
        </div>
      </div>
    </section>
  );
}
