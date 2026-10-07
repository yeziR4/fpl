import type { Metadata } from "next";
import { MarketDetail } from "@/components/panta/MarketDetail";

/**
 * /market?id=<marketId>
 *
 * A query parameter rather than /market/[id] because this is a static export
 * and Next needs generateStaticParams() for dynamic routes in that mode --
 * market ids are created at runtime on Solana, so the set is unknowable at
 * build time. See the note at the top of MarketDetail.tsx.
 *
 * The page itself is a thin server component; the client component fetches the
 * market, because a build-time fetch would bake in a price that is wrong the
 * moment the market moves.
 */
export const metadata: Metadata = {
  title: "Market — Overline",
  description:
    "A live FPL points market on Panta, on Solana. Real prices, real liquidity, resolved against official FPL data.",
};

export default function MarketPage() {
  return <MarketDetail />;
}
