import Link from "next/link";
import { ComingUp } from "@/components/research/ComingUp";
import { ParticipantTable } from "@/components/research/ParticipantTable";
import { StudyMarkets } from "@/components/research/StudyMarkets";
import { Avatar, LabBadge } from "@/components/research/Marks";
import { HUMAN_COUNT, STUDY, forecastsForForecasters, statusCounts } from "@/lib/study";

/**
 * The study page. This is the whole point of the project, and it is not a
 * product page.
 *
 * We do not take bets and we do not run a book. Every position described here
 * lives on Panta, on Solana, and every one links to a transaction anybody can
 * check. What this page adds is the thing Panta's own UI cannot show: what each
 * participant SAID before the outcome was known, next to what they did.
 *
 * The ORDER is deliberate, and it changed after reading it back. The data comes
 * first, immediately under the masthead, because the table IS the argument --
 * somebody arriving from a post should hit evidence, not a preamble about our
 * method. Method then explains what they just saw, which is the order a reader
 * actually wants it in.
 */

export default function Home() {
  const agentForecasts = forecastsForForecasters("agent");
  const humanForecasts = forecastsForForecasters("human");
  const agents = statusCounts(agentForecasts);
  const committed = agentForecasts
    .filter((f) => f.status === "placed")
    .reduce((sum, f) => sum + (f.stakeUsdc ?? 0), 0);

  return (
    <main className="flex flex-1 flex-col">
      <Masthead
        positions={agents.placed}
        committed={committed}
        humanForecasts={humanForecasts.length}
      />

      {/* The evidence, first. */}
      <Section
        id="data"
        kicker={`Gameweek ${STUDY.gw}`}
        title="Humans vs AI models"
        lede="One row per participant. Click anyone to see every call they made — what they said, what the price was, and whether it reached the chain. Sorting is by position actually placed, because on a page about who committed what, the order should answer that question."
      >
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Positions on chain" value={String(agents.placed)} accent />
          <Stat label="Capital committed" value={`$${committed.toFixed(2)}`} />
          <Stat label="Human calls recorded" value={String(HUMAN_COUNT)} />
          <Stat label="Humans backing YES" value={String(humanForecasts.filter((f) => f.side === "yes").length)} />
        </div>

        <ParticipantTable forecasts={[...agentForecasts, ...humanForecasts]} />

        {/*
          The one piece of context a reader genuinely cannot infer. The models
          risk their own money; the humans do not, and pretending otherwise would
          be the single most misleading thing this page could do.
        */}
        <p className="mt-4 max-w-3xl text-[12.5px] leading-relaxed text-foreground/45">
          <strong className="font-semibold text-foreground/65">One thing to hold in mind.</strong>{" "}
          Every model stakes its own bankroll, so its calls are filtered through &ldquo;do I
          actually believe this?&rdquo;. The human calls this gameweek are staked by us — they
          risked nothing to make them, and that difference is recorded rather than smoothed over.
        </p>
      </Section>

      <Section
        id="method"
        kicker="Method"
        title="Same question, same moment, five models and anyone who wants to join"
        lede="Every gameweek, five frontier models are given an identical prompt: the same markets, the same pool prices, the same player data, and the same bankroll. Each states a probability and a reason, then trades its own wallet on Panta. Public forecasters are recorded the same way, from what they say openly. Nothing is scored on accuracy alone — and more frontier models will be added as they ship."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            title="They see the real price"
            body="The pool price is printed in the prompt, so a model trades against the market rather than against our model of it. It cannot move that price by sounding confident."
          />
          <Fact
            title="They state a probability first"
            body="Not just a side. A probability recorded before the outcome is what makes calibration measurable, and what separates a forecast from a guess."
          />
          <Fact
            title="Each model has its own wallet"
            body="Five separate Solana wallets, so a model's P&L is a fact about the chain rather than a row in our own ledger. On an earlier version it was exactly that, and the difference matters."
          />
          <Fact
            title="We do not settle anything"
            body="Panta resolves against the official FPL data and pays out on chain. We publish the forecasts and the receipts, and nothing else."
          />
        </div>
      </Section>

      <Section
        id="participants"
        kicker="Who is taking part"
        title="Five models, one per lab"
        lede="Chosen for genuine cross-lab diversity rather than several models from one family, and more labs will be added as they ship. Humans join by posting a prediction publicly; the ones who do are recorded here alongside the models, with their own words."
      >
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {STUDY.participants
            .filter((p) => p.kind === "agent")
            .map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-lg border border-hairline bg-surface p-3.5"
              >
                <LabBadge slug={p.id} size={30} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13.5px] font-semibold text-foreground">
                    {p.name}
                  </span>
                  <span className="truncate text-[11px] text-foreground/45">{p.subtitle}</span>
                </div>
              </div>
            ))}
        </div>

        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.09em] text-foreground/45">
            Public forecasters
          </h3>
          <span className="text-[11.5px] text-foreground/35">
            {HUMAN_COUNT === 0
              ? "none recorded yet — see how to take part below"
              : `${HUMAN_COUNT} recorded`}
          </span>
        </div>

        {HUMAN_COUNT > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STUDY.participants
              .filter((p) => p.kind === "human")
              .map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border border-hairline bg-surface p-3.5"
                >
                  <Avatar src={p.avatarUrl} name={p.name} size={30} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13.5px] font-semibold text-foreground">
                      {p.name}
                    </span>
                    <span className="truncate text-[11px] text-foreground/45">{p.subtitle}</span>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <p className="max-w-2xl rounded-lg border border-dashed border-hairline px-5 py-6 text-[13.5px] leading-relaxed text-foreground/55">
            Nobody has posted a prediction yet. When they do, their handle, avatar and exact words
            appear in the table above beside the models — same columns, same scoring. A human
            forecast is evidence about human judgement, so it is recorded the same way an
            agent&rsquo;s is, with no tidying up.
          </p>
        )}
      </Section>

      <StudyMarkets />

      <Section
        id="take-part"
        kicker="Take part"
        title="Post a prediction. Keep the winnings."
        lede="Anyone can join the study. You do not need a wallet to take part, and you do not need to know anything about Solana."
      >
        <ol className="grid gap-3 sm:grid-cols-3">
          <Step n={1} title="Comment your call and your reason">
            Say which market and which side, and why. The reason is the part that gets recorded —
            &ldquo;Haaland 8+ is too high away at Anfield&rdquo; is a forecast; &ldquo;no&rdquo; is a
            coin flip.
          </Step>
          <Step n={2} title="The strongest ones get placed on chain">
            We help the best calls become real positions on Panta, using your handle. Your
            prediction, your words, and the transaction are all recorded here.
          </Step>
          <Step n={3} title="It settles against the official data">
            Panta resolves the market against the FPL site and pays out on chain. You keep whatever
            it pays. We take nothing.
          </Step>
        </ol>

        <div className="mt-6 rounded-lg border border-hairline bg-surface p-5">
          <h3 className="mb-2 text-[13px] font-semibold text-foreground">
            Why we are doing this in public
          </h3>
          <p className="max-w-3xl text-[13.5px] leading-relaxed text-foreground/60">
            Forecasts are usually scored after the fact, which makes it easy to remember being
            right. Here every prediction is written down before the event, with a probability and a
            reason, and settled by something none of us controls. That applies to the models exactly
            as it applies to you — the whole point is that neither gets to edit afterwards.
          </p>
          <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-foreground/40">
            Nothing here is financial advice, and no outcome is guaranteed. Prediction markets carry
            real risk of losing whatever you put in.
          </p>
        </div>
      </Section>

      <ComingUp />
    </main>
  );
}

// ------------------------------------------------------------------ chrome

function Masthead({
  positions,
  committed,
  humanForecasts,
}: {
  positions: number;
  committed: number;
  humanForecasts: number;
}) {
  return (
    <section className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-6 py-16 sm:px-10">
        <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent">
          An open study · Gameweek {STUDY.gw}
        </span>
        <h1 className="mt-4 max-w-4xl font-display text-4xl font-black uppercase leading-[0.98] text-foreground sm:text-6xl">
          Can AI agents price a footballer better than the crowd?
        </h1>
        <p className="mt-5 max-w-2xl text-[15.5px] leading-relaxed text-foreground/60">
          Five frontier models and a set of public forecasters, all pricing the same Fantasy Premier
          League markets, all on the record before kickoff. On this gameweek&rsquo;s three markets
          they ended up on opposite sides of the same pool — so the payout decides it, not us.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-[12.5px] text-foreground/50">
          <span>
            <strong className="font-display text-lg font-black text-foreground">{positions}</strong>{" "}
            positions on chain
          </span>
          <span>
            <strong className="font-display text-lg font-black text-foreground">
              ${committed.toFixed(2)}
            </strong>{" "}
            committed
          </span>
          <span>
            <strong className="font-display text-lg font-black text-foreground">{HUMAN_COUNT}</strong>{" "}
            human forecasters
          </span>
          <span>
            <strong className="font-display text-lg font-black text-foreground">
              {STUDY.markets.length}
            </strong>{" "}
            markets this gameweek
          </span>
          {humanForecasts === 0 && (
            <Link
              href="#take-part"
              className="font-semibold text-accent underline-offset-2 hover:underline"
            >
              Add yours →
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function Section({
  id,
  kicker,
  title,
  lede,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-b border-hairline">
      <div className="mx-auto max-w-7xl px-6 py-16 sm:px-10">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">
          {kicker}
        </span>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-black uppercase leading-[1.02] text-foreground sm:text-4xl">
          {title}
        </h2>
        <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-foreground/60">{lede}</p>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

function Fact({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <h3 className="mb-2 text-[13px] font-semibold text-foreground">{title}</h3>
      <p className="text-[12.5px] leading-relaxed text-foreground/55">{body}</p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
      <span
        className={`font-display text-2xl font-black leading-none tnum ${
          accent ? "text-accent" : "text-foreground"
        }`}
      >
        {value}
      </span>
      <span className="mt-1 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-foreground/40">
        {label}
      </span>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-hairline bg-surface p-4">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-[12px] font-bold text-accent">
        {n}
      </span>
      <h3 className="mb-2 mt-3 text-[13.5px] font-semibold text-foreground">{title}</h3>
      <p className="text-[12.5px] leading-relaxed text-foreground/55">{children}</p>
    </li>
  );
}
