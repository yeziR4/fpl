import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // FPL's image CDN, for real player photos and team badges (see
    // src/lib/fpl.ts). Not verified against a live response from this
    // dev sandbox -- see docs/architecture.md in the repo root.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "resources.premierleague.com",
        pathname: "/premierleague/**",
      },
    ],
  },
};

export default nextConfig;
