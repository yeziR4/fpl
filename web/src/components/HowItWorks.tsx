const STEPS = [
  {
    number: "01",
    title: "Pick a market",
    body: "Choose a player and a line — will they clear 5 points this match, or the rarer 10-point bar. Two markets, every gameweek.",
  },
  {
    number: "02",
    title: "Stake your side",
    body: "Everyone staking the same side pools together. There's no house setting the odds — the pool itself is the price.",
  },
  {
    number: "03",
    title: "Settled on-chain",
    body: "The moment the gameweek's last match finishes, the market resolves against real data and payouts settle automatically.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-foreground/10 bg-background">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:px-10">
        <div className="mb-12 flex flex-col gap-3">
          <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">
            The mechanics
          </span>
          <h2 className="font-display text-4xl font-black uppercase leading-[0.98] text-foreground sm:text-5xl">
            How it works
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-8">
          {STEPS.map((step) => (
            <div key={step.number} className="flex flex-col gap-3">
              <span className="font-display text-3xl font-black text-accent/40">{step.number}</span>
              <h3 className="font-display text-xl font-extrabold uppercase tracking-[0.02em] text-foreground">
                {step.title}
              </h3>
              <p className="text-[14.5px] leading-relaxed text-foreground/60">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
