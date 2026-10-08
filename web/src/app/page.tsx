import { Hero } from "@/components/Hero";
import { LiveMarkets } from "@/components/panta/LiveMarkets";
import { Pipeline } from "@/components/panta/Pipeline";
import { HowItWorks } from "@/components/HowItWorks";
import type { HeroPlayer } from "@/components/Hero";
import {
  fetchBootstrapStatic,
  fetchFixtures,
  nextFixtureForTeam,
  teamBadgeUrl,
  teamCodeForId,
  topExpensivePlayers,
  type BootstrapStatic,
  type Fixture,
} from "@/lib/fpl";

const HERO_PLAYER_COUNT = 3;

/**
 * The home page is deliberately thin now. It renders three sections, and only
 * the hero needs data at build time:
 *
 *   Hero        -- FPL players, fetched here (this file)
 *   LiveMarkets -- real Panta markets, fetched in the browser (prices move)
 *   Pipeline    -- the generator's ranked candidates, read from a committed
 *                  JSON snapshot, because it changes when the generator runs
 *
 * What used to be here and is gone: a markets grid of Vara staking widgets,
 * and per-player agent-pick counts read from the old VARA-era picks files. The
 * staking UI went with the chain, and the picks data is being replaced by the
 * agent benchmark -- whose whole point is that the numbers are real positions
 * on Panta rather than a simulated stake in a retired token.
 */
export default async function Home() {
  const players = await loadHeroPlayers();

  return (
    <main className="flex flex-1 flex-col">
      <Hero players={players} />
      <LiveMarkets />
      <Pipeline />
      <HowItWorks />
    </main>
  );
}

/**
 * The top players by price, each with their next opponent, for the hero.
 *
 * FPL's API is public and unauthenticated but still an external dependency, so
 * this fails soft to an empty list rather than crashing the page: Hero renders
 * sensibly with nobody in it. Same contract the rest of the site follows.
 */
async function loadHeroPlayers(): Promise<HeroPlayer[]> {
  try {
    const [bootstrap, fixtures]: [BootstrapStatic, Fixture[]] = await Promise.all([
      fetchBootstrapStatic(),
      fetchFixtures(),
    ]);

    return topExpensivePlayers(bootstrap, HERO_PLAYER_COUNT).map((player) => {
      const nextFixture = nextFixtureForTeam(player.team, fixtures);
      return {
        player,
        badgeUrl: teamBadgeUrl(teamCodeForId(bootstrap, player.team)),
        opponent: resolveOpponent(bootstrap, nextFixture),
      };
    });
  } catch (error) {
    console.error("Failed to load FPL player/fixture data:", error);
    return [];
  }
}

interface HeroOpponent {
  badgeUrl: string;
  shortName: string;
  isHome: boolean;
}

function resolveOpponent(
  bootstrap: BootstrapStatic,
  nextFixture: ReturnType<typeof nextFixtureForTeam>,
): HeroOpponent | null {
  if (!nextFixture) return null;
  const opponentTeam = bootstrap.teams.find((t) => t.id === nextFixture.teamId);
  if (!opponentTeam) return null;
  return {
    badgeUrl: teamBadgeUrl(opponentTeam.code),
    shortName: opponentTeam.short_name,
    isHome: nextFixture.isHome,
  };
}
