import { Hero } from "@/components/Hero";
import { MarketsSection } from "@/components/MarketsSection";
import { HowItWorks } from "@/components/HowItWorks";
import type { HeroPlayer } from "@/components/Hero";
import type { MarketOpponent, MarketPlayer } from "@/components/MarketsSection";
import {
  fetchBootstrapStatic,
  fetchFixtures,
  opponentFor,
  relevantGameweekId,
  teamBadgeUrl,
  teamCodeForId,
  topExpensivePlayers,
  type BootstrapStatic,
  type Fixture,
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
 * Fetches the top-expensive-players pool and this gameweek's fixtures
 * once, and shapes it for both the hero (first 3) and the markets grid
 * (all of them) -- including each player's opponent for the relevant
 * gameweek, since that's directly relevant to whether they'll clear a
 * points threshold.
 *
 * FPL's API is unauthenticated and public, but still an external
 * dependency -- if it's unreachable (as it is from this dev sandbox;
 * see docs/architecture.md) or FPL is down, fail soft with an empty
 * list rather than crashing the page. Both Hero and MarketsSection
 * render sensibly with zero players.
 */
async function loadMarketPlayers(): Promise<(HeroPlayer & MarketPlayer)[]> {
  try {
    const [bootstrap, fixtures]: [BootstrapStatic, Fixture[]] = await Promise.all([
      fetchBootstrapStatic(),
      fetchFixtures(),
    ]);
    const gw = relevantGameweekId(bootstrap);
    const players: Player[] = topExpensivePlayers(bootstrap, MARKET_PLAYER_COUNT);

    return players.map((player) => ({
      player,
      badgeUrl: teamBadgeUrl(teamCodeForId(bootstrap, player.team)),
      opponent: gw ? resolveOpponent(bootstrap, fixtures, player.team, gw) : null,
    }));
  } catch (error) {
    console.error("Failed to load FPL player/fixture data:", error);
    return [];
  }
}

function resolveOpponent(
  bootstrap: BootstrapStatic,
  fixtures: Fixture[],
  playerTeamId: number,
  gw: number,
): MarketOpponent | null {
  const opponent = opponentFor(playerTeamId, gw, fixtures);
  if (!opponent) return null;
  const opponentTeam = bootstrap.teams.find((t) => t.id === opponent.teamId);
  if (!opponentTeam) return null;
  return {
    badgeUrl: teamBadgeUrl(opponentTeam.code),
    shortName: opponentTeam.short_name,
    isHome: opponent.isHome,
  };
}
