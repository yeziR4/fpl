import { Hero } from "@/components/Hero";
import { MarketsSection } from "@/components/MarketsSection";
import { HowItWorks } from "@/components/HowItWorks";
import type { HeroPlayer } from "@/components/Hero";
import type { MarketPlayer } from "@/components/MarketsSection";
import {
  fetchBootstrapStatic,
  teamBadgeUrl,
  teamCodeForId,
  topExpensivePlayers,
  type BootstrapStatic,
  type Player,
} from "@/lib/fpl";

const MARKET_PLAYER_COUNT = 8;

export default async function Home() {
  const players = await loadMarketPlayers();

  return (
    <main className="flex flex-1 flex-col">
      <Hero players={players.slice(0, 3)} />
      <MarketsSection players={players} />
      <HowItWorks />
    </main>
  );
}

/**
 * Fetches the top-expensive-players pool once and shapes it for both
 * the hero (first 3) and the markets grid (all of them).
 *
 * FPL's API is unauthenticated and public, but still an external
 * dependency -- if it's unreachable (as it is from this dev sandbox;
 * see docs/architecture.md) or FPL is down, fail soft with an empty
 * list rather than crashing the page. Both Hero and MarketsSection
 * render sensibly with zero players.
 */
async function loadMarketPlayers(): Promise<(HeroPlayer & MarketPlayer)[]> {
  try {
    const bootstrap: BootstrapStatic = await fetchBootstrapStatic();
    const players: Player[] = topExpensivePlayers(bootstrap, MARKET_PLAYER_COUNT);
    return players.map((player) => ({
      player,
      badgeUrl: teamBadgeUrl(teamCodeForId(bootstrap, player.team)),
    }));
  } catch (error) {
    console.error("Failed to load FPL player data:", error);
    return [];
  }
}
