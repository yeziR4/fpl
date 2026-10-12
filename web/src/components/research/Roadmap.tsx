import { ALL_MARKETS, HUMAN_COUNT, STUDY } from "@/lib/study";

/**
 * Where this goes next.
 *
 * Replaces a "markets we are listing next" table. That answered a question
 * nobody asks -- which candidate lines scored well -- and said nothing about
 * whether the thing continues past this weekend, which is the question a judge
 * funding it actually has.
 *
 * Every item is labelled with when it happens, because a roadmap that mixes
 * shipped work with intentions reads as a wish list. "Running now" is a fact.
 * "Next gameweek" is a commitment. "Ongoing" is a direction. They are marked.
 */

interface Item {
  when: string;
  title: string;
  body: string;
  tone: "now" | "next" | "ongoing";
}

export function Roadmap() {
  const items: Item[] = [
    {
      when: "Running now",
      tone: "now",
      title: "A gameweek is a round",
      body: `${STUDY.markets.length} markets, five frontier models with their own wallets and bankrolls, and ${HUMAN_COUNT} public forecasters on the record. Every round produces a settled result, and every participant carries their running record into the next one.`,
    },
    {
      when: "Next gameweek",
      tone: "next",
      title: "Calls through X, placed on chain",
      body: "Reply to the weekly post with a side and a reason. Today that gets you recorded; the next step is connecting a wallet so the call becomes your own position rather than ours. The reply stays the entry point, because it already works — 47 replies arrived without anyone needing to understand Solana first.",
    },
    {
      when: "Next gameweek",
      tone: "next",
      title: "More than one league",
      body: "Football first because we know the data. Next is NFL fantasy scoring — same mechanic, same thresholds, different sport — then other leagues where a public, machine-readable points feed exists. The pipeline that scores candidate lines is not sport-specific.",
    },
    {
      when: "Ongoing",
      tone: "ongoing",
      title: "The market pays for the next market",
      body: "Every market charges the creator a fee and pays a royalty that scales with how evenly the crowd splits. Those returns, and the winnings on positions we hold, go back into seeding the next round's liquidity instead of out of the project. A round that earns its own listing cost is a round that can keep running.",
    },
    {
      when: "Ongoing",
      tone: "ongoing",
      title: "Grants, and more labs",
      body: "Ecosystem grants and platform programmes fund the compute and the market fees that a self-sustaining round cannot yet cover on its own. New frontier models are added as they ship, each with a fresh bankroll and an empty record.",
    },
  ];

  return (
    <section id="roadmap" className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-6 py-16 sm:px-10">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">
          Roadmap
        </span>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-black uppercase leading-[1.02] text-foreground sm:text-4xl">
          Where this goes next
        </h2>
        <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-foreground/60">
          One gameweek is a demo. The point is a benchmark that keeps running — more models, more
          forecasters, more markets — with a record nobody can edit afterwards because the chain
          holds it.
        </p>

        <ol className="mt-8 grid gap-3 lg:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.title}
              className={`rounded-lg border p-5 ${
                item.tone === "now"
                  ? "border-accent/40 bg-accent/[0.06]"
                  : "border-hairline bg-surface"
              }`}
            >
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] ${
                  item.tone === "now"
                    ? "bg-accent/20 text-accent"
                    : item.tone === "next"
                      ? "bg-surface-strong text-foreground/60"
                      : "bg-surface-strong text-foreground/40"
                }`}
              >
                {item.when}
              </span>
              <h3 className="mb-2 mt-3 text-[14.5px] font-semibold text-foreground">{item.title}</h3>
              <p className="text-[12.5px] leading-relaxed text-foreground/55">{item.body}</p>
            </li>
          ))}
        </ol>

        <p className="mt-6 max-w-3xl text-[12.5px] leading-relaxed text-foreground/40">
          The items marked <em>running now</em> are shipped: {ALL_MARKETS.length} markets settled on
          Solana mainnet through the Panta API, with every position and every reason published. The
          rest are what we intend to build, and are labelled as intentions rather than described as
          work already done.
        </p>
      </div>
    </section>
  );
}
