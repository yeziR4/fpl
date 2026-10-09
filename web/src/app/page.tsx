import Link from "next/link";
import { LiveMarkets } from "@/components/panta/LiveMarkets";
import { Pipeline } from "@/components/panta/Pipeline";
import { ForecastTable, ParticipantSummary } from "@/components/research/ForecastTable";
import { Avatar, LabBadge } from "@/components/research/Marks";
import { HUMAN_COUNT, STUDY, forecastsForForecasters, statusCounts } from "@/lib/study";

/**
 * The study page. This is the whole point of the project, and it is not a
 * product page.
 *
 * We do not take bets and we do not run a book. Every position described here
 * lives on Panta, on Solana, and every one links to a transaction anybody can
 * check. What this page adds is the thing Panta's own UI cannot show: what each
 * participant SAID before the outcome was known, and how that compares to what
 * they did.
 *
 * That distinction is the entire reason the page exists. A P&L number tells you
 * who got lucky. A stated probability, recorded before the fact and settled
 * against a public oracle, tells you who was calibrated -- and the gap between
 * those two is what this study is measuring.
 */

export default function Home() {
  const agentForecasts = forecastsForForecasters("agent");
  const humanForecasts = forecastsForForecasters("human");
  const agents = statusCounts(agentForecasts);
  const committed = agentForecasts
    .filter((f) => f.status === "placed")
    .reduce((sum, f) => sum + (f.stakeUsdc ?? 0), 0);
  const passedEntirely = STUDY.participants.filter(
    (p) =>
      p.kind === "agent" &&
      agentForecasts.some((f) => f.participant.id === p.id) &&
      agentForecasts.filter((f) => f.participant.id === p.id).every((f) => f.status === "passed"),
  ).length;

  return (
    <main className="flex flex-1 flex-col">
      <Masthead positions={agents.placed} committed={committed} humanForecasts={humanForecasts.length} />

      <Section
        id="method"
        kicker="Method"
        title="Same question, same moment, five models and anyone who wants to join"
        lede="Every gameweek, five frontier models are given an identical prompt: the same markets, the same pool prices, the same player data, and the same bankroll. Each states a probability and a reason, then trades its own wallet on Panta. Public forecasters are recorded the same way, from what they say openly. Nothing is scored on accuracy alone."
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
        lede="Chosen for genuine cross-lab diversity rather than several models from one family. Humans join by posting a prediction publicly; the ones who do are recorded here alongside the models, with their own words."
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
                  <span className="truncate text-[13.5px] font-semibold text-foreground">{p.name}</span>
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
                    <span className="truncate text-[13.5px] font-semibold text-foreground">{p.name}</span>
                    <span className="truncate text-[11px] text-foreground/45">{p.subtitle}</span>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <p className="max-w-2xl rounded-lg border border-dashed border-hairline px-5 py-6 text-[13.5px] leading-relaxed text-foreground/55">
            Nobody has posted a prediction yet. When they do, their handle, avatar and exact words
            appear in the table below beside the models — same columns, same scoring. A human
            forecast is evidence about human judgement, so it is recorded the same way an
            agent&rsquo;s is, with no tidying up.
          </p>
        )}
      </Section>

      <Section
        id="data"
        kicker={`Gameweek ${STUDY.gw}`}
        title="Every forecast, side by side"
        lede="One row per participant per market, grouped by market so the disagreement is visible: four models read the forwards the same way and one did not."
      >
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Positions on chain" value={String(agents.placed)} accent />
          <Stat label="Capital committed" value={`$${committed.toFixed(2)}`} />
          <Stat label="Forecasts that found no edge" value={String(agents["no-trade"])} />
          <Stat label="Models that passed entirely" value={String(passedEntirely)} />
        </div>

        <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.09em] text-foreground/45">
          By participant
        </h3>
        <ParticipantSummary forecasts={agentForecasts} />

        <h3 className="mb-3 mt-8 text-[12px] font-semibold uppercase tracking-[0.09em] text-foreground/45">
          Every forecast
        </h3>
        <ForecastTable forecasts={[...agentForecasts, ...humanForecasts]} />

        <p className="mt-4 max-w-3xl text-[12.5px] leading-relaxed text-foreground/45">
          <strong className="font-semibold text-foreground/65">Reading the columns.</strong>{" "}
          <em>Stated P</em> is the probability the participant gave for the market resolving YES, as
          they gave it. <em>Pool price</em> is what the side they took cost at that moment.{" "}
          <em>Edge</em> is the difference between the two — their claim that the market was wrong.{" "}
          <em>On chain</em> means a real transaction exists and links to it. <em>Unfilled</em> means
          they wanted the trade and could not fund it, which is a result too: one model committed
          its entire bankroll and the ~2% trading fee left its last pick unplaceable.
        </p>
      </Section>

      <LiveMarkets />

      <Section
        id="take-part"
        kicker="Take part"
        title="Post a prediction. Keep the winnings."
        lede="Anyone can join the study. You do not need a wallet to take part, and you do not need to know anything about Solana."
      >
        <ol className="grid gap-3 sm:grid-cols-3">
          <Step n={1} title="Comment your call and your reason">
            Say which market and which side, and why. The reason is the part that gets recorded —
            &ldquo;Haaland 8+ is too high away at Anfield&rdquo; is a forecast; &ldquo;no&rdquo; is
            a coin flip.
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

      <Pipeline />
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
          Can a machine price a footballer better than a crowd?
        </h1>
        <p className="mt-5 max-w-2xl text-[15.5px] leading-relaxed text-foreground/60">
          Five frontier models and a set of public forecasters, all pricing the same Fantasy Premier
          League markets, all on the record before kickoff. Every position is real, on Solana, and
          checkable by anyone.
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
