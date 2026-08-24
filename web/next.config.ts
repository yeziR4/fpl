import type { NextConfig } from "next";

// Set only by the GitHub Pages deploy workflow (.github/workflows/deploy-web.yml).
// Local dev (`npm run dev`) and a normal `npm run build` stay full Next.js --
// full SSR, no basePath, image optimization on. GitHub Pages can only serve
// static files and can't run the image optimizer, so the Pages build needs a
// static export, unoptimized images, and a basePath matching the repo name
// (project sites serve at <owner>.github.io/<repo>/, not the domain root).
const isGithubPagesBuild = process.env.GITHUB_PAGES === "true";

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
    ...(isGithubPagesBuild ? { unoptimized: true } : {}),
  },
  ...(isGithubPagesBuild
    ? {
        output: "export",
        basePath: "/fpl",
        assetPrefix: "/fpl/",
      }
    : {}),
};

export default nextConfig;
