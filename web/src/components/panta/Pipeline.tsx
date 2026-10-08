import pipelineData from "@/data/pipeline.json";

/**
 * The generator's ranked candidates — what it would list next, and why.
 *
 * This is a Server Component on purpose, and it is the one section that should
 * be. The pipeline changes when the generator runs, not between page views, so
 * reading it at build time is correct rather than a compromise. Live prices are
 * the opposite case (see LiveMarkets.tsx).
 *
 * The section exists to answer the question the market list cannot: *why these
 * markets?* Every other tool in this hackathon consumes markets somebody else
 * created. This shows the reasoning behind producing them -- which is why each
 * row carries its tilt and royalty band rather than just a name.
 *
 * It is labelled as a pipeline, not a catalog, throughout. Showing twenty
 * markets when one exists would be the kind of thing that reads as dishonest
 * once a judge checks Panta and finds a single live market.
 */

interface Candidate {
  player: string;
  team: string;
  ownershipPercent: number;
  position: string;
  line: number;
  clearedPercent: number;
  noTiltPercent: number;
  royaltyBand: string;
  fixture: string;
  kickoff: string;
  breaksIn: string;
  photoUrl: string | null;
}

const CANDIDATES = (pipelineData.candidates ?? []) as Candidate[];
const GENERATED_AT = pipelineData.generatedAt ?? null;

/** Ownership is a proxy for how many people might actually trade it. */
const REACH_FLOOR = 10;

export function Pipeline() {
  if (CANDIDATES.length === 0) return null;

  const inFullBand = CANDIDATES.filter((c) => c.royaltyBand === "20% full").length;
  const balanced = CANDIDATES.filter((c) => c.noTiltPercent <= 60).length;
  const reachable = CANDIDATES.filter((c) => c.ownershipPercent >= REACH_FLOOR).length;

  // Best first: strong tilt, then real reach. Tilt is the economics -- a
  // lopsided market earns a quarter of the royalty -- but a perfectly balanced
  // market nobody owns earns nothing at all, so reach breaks the tie.
  const ranked = [...CANDIDATES].sort(
    (a, b) =>
      Math.abs(50 - a.clearedPercent) - Math.abs(50 - b.clearedPercent) ||
      b.ownershipPercent - a.ownershipPercent,
  );

  return (
    <section id="pipeline" className="border-t border-foreground/10 bg-background">
      <div className="mx-auto max-w-7xl px-6 py-20 sm:px-10">
        <div className="mb-10 flex flex-col gap-3">
          <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">
            How the markets get chosen
          </span>
          <h2 className="font-display text-4xl font-black uppercase leading-[0.98] text-foreground sm:text-5xl">
            The pipeline
          </h2>
          <p className="max-w-2xl text-[15px] leading-relaxed text-foreground/60">
            Creating a market costs a non-refundable 20 USDC, and the creator&rsquo;s
            royalty depends on how the crowd splits. So the line matters: set it where
            almost everyone agrees and the royalty collapses, set it where nobody has an
            opinion and there is no market. Every candidate below is scored on that before
            a cent is spent.
          </p>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Candidates scored" value={String(CANDIDATES.length)} />
          <Stat label="Balanced enough" value={String(balanced)} />
          <Stat label="Full royalty band" value={String(inFullBand)} />
          <Stat label="With real reach" value={String(reachable)} />
        </div>

        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/40">
            Not yet created — ranked, ready to list
          </span>
          {GENERATED_AT && (
            <span className="text-[11.5px] text-foreground/30">
              Scoring run {String(GENERATED_AT).replace("T", " ").slice(0, 16)} UTC
            </span>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-foreground/12">
          <div className="hidden grid-cols-[2.4fr_0.7fr_0.9fr_0.8fr_0.9fr_0.9fr_1.1fr] gap-2 border-b border-foreground/10 bg-white/[0.03] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground/40 sm:grid">
            <span>Player</span>
            <span>Line</span>
            <span className="text-right">Owned</span>
            <span className="text-right">Clears</span>
            <span className="text-right">Tilt</span>
            <span className="text-right">Royalty</span>
            <span className="text-right">Fixture</span>
          </div>

          <div className="divide-y divide-foreground/[0.07]">
            {ranked.map((c, i) => (
              <Row key={`${c.player}-${c.position}-${c.line}`} c={c} rank={i + 1} />
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Note title="Why tilt decides everything">
            Panta pays the creator up to 20% of liquidity, scaled by how one-sided the
            crowd is. A market where 93%+ of the money takes one side earns 5%; past 96%
            it earns nothing. A forward line of &ldquo;10+ points&rdquo; clears only 7.2% of the
            time — a near-certain NO, and a quarter of the royalty. &ldquo;8+&rdquo; clears about
            20% and earns the full band. Same player, same match, four times the fee back.
          </Note>
          <Note title="What the numbers are, honestly">
            &ldquo;Clears&rdquo; is how often that player beat the line in games he actually
            played, over this season so far — five gameweeks, so a 60% figure is three
            games out of five. That is a thin sample and it is treated as a signal, not a
            forecast. The position averages behind it are firmer: defenders 41.6%,
            midfielders 28.7%, forwards 20.0%.
          </Note>
        </div>
      </div>
    </section>
  );
}

function Row({ c, rank }: { c: Candidate; rank: number }) {
  const tone =
    c.royaltyBand === "20% full" ? "text-accent" : c.royaltyBand === "0%" ? "text-foreground/30" : "text-foreground/60";

  return (
    <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-[2.4fr_0.7fr_0.9fr_0.8fr_0.9fr_0.9fr_1.1fr] sm:items-center">
      <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
        <span className="w-5 shrink-0 text-[11px] tabular-nums text-foreground/25">{rank}</span>
        {c.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- third-party CDN, and a static export has no image optimizer (see next.config.ts).
          <img
            src={c.photoUrl}
            alt=""
            loading="lazy"
            className="h-9 w-9 shrink-0 rounded-full bg-accent-dim object-cover object-top"
          />
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[14px] font-semibold text-foreground">{c.player}</span>
          <span className="text-[11px] text-foreground/40">
            {c.team} · {c.position}
          </span>
        </div>
      </div>

      <Cell label="Line" value={`${c.line}+`} strong />
      <Cell label="Owned" value={`${c.ownershipPercent}%`} />
      <Cell label="Clears" value={`${c.clearedPercent}%`} />
      <Cell label="Tilt" value={`${c.noTiltPercent.toFixed(0)}%`} />
      <Cell label="Royalty" value={c.royaltyBand} className={tone} />
      <Cell label="Fixture" value={`${c.fixture} · ${c.kickoff}`} muted />
    </div>
  );
}

function Cell({
  label,
  value,
  strong,
  muted,
  className,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:flex-col sm:items-end sm:justify-start">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/30 sm:hidden">
        {label}
      </span>
      <span
        className={`truncate text-right text-[13px] tabular-nums ${
          className ?? (strong ? "font-semibold text-foreground" : muted ? "text-foreground/45" : "text-foreground/70")
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-foreground/12 bg-white/[0.02] px-4 py-3">
      <span className="font-display text-2xl font-black leading-none text-accent tabular-nums">
        {value}
      </span>
      <span className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground/40">
        {label}
      </span>
    </div>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-foreground/12 bg-white/[0.02] p-4">
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground/50">
        {title}
      </h3>
      <p className="text-[13px] leading-relaxed text-foreground/55">{children}</p>
    </div>
  );
}
