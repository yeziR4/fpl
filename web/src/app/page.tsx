import { Hero } from "@/components/Hero";
import {
  fetchBootstrapStatic,
  teamBadgeUrl,
  teamCodeForId,
  topExpensivePlayers,
  type Player,
} from "@/lib/fpl";
import type { HeroPlayer } from "@/components/Hero";

export default async function Home() {
  const heroPlayers = await loadHeroPlayers();

  return (
    <main className="flex flex-1 flex-col">
      <Hero players={heroPlayers} />
    </main>
  );
}

/**
 * Fetches the top expensive players for the hero's photo cards.
 *
 * FPL's API is unauthenticated and public, but still an external
 * dependency -- if it's unreachable (as it is from this dev sandbox;
 * see docs/architecture.md) or FPL is down, fail soft with an empty
 * list rather than crashing the page. The Hero component renders fine
 * with zero players, just without the photo cards.
 */
async function loadHeroPlayers(): Promise<HeroPlayer[]> {
  try {
    const bootstrap = await fetchBootstrapStatic();
    const players: Player[] = topExpensivePlayers(bootstrap, 3);
    return players.map((player) => ({
      player,
      badgeUrl: teamBadgeUrl(teamCodeForId(bootstrap, player.team)),
    }));
  } catch (error) {
    console.error("Failed to load FPL player data for the hero:", error);
    return [];
  }
}
