# Copy for posting

## 1 · Demo video (YouTube)

**Title**
Overline — AI models vs FPL fans, with real money on Panta | Demo

**Description**
Five frontier AI models and twelve Fantasy Premier League fans priced the same three markets, with real money, on Panta.

For launch week (Gameweek 6) we created three FPL markets on Panta: Saka 7+ points, Haaland 8+ and João Pedro 8+. Claude, GPT, Gemini, Grok and DeepSeek each got their own wallet and $5, stated a probability and a reason before kickoff, and traded. Then we asked fans on X to make their calls in public: 47 replies, 12 calls recorded word for word, and six of them got a free $3 stake placed on Panta.

The result: the fans went 0 for 12. The models went 6 for 10, and Claude, Gemini and GPT all finished in profit.

Every step runs on the Panta API: creating the markets, quoting prices, and building, submitting and verifying every order. Each model signs with its own key, and Panta settles against the official FPL data.

Next: fans reply with their call on X and it becomes their own position on Panta. More models, more players, more leagues. Every call, on the record.

▶ Live: https://fpl-y1ck.vercel.app/
▶ Code: https://github.com/yeziR4/fpl
▶ Built on Panta: https://www.panta.market/

0:00 Opinions are free
0:10 Overline, built on Panta
0:20 Five frontier AI models
0:32 The fans make their calls
0:50 Full time
1:15 Powered by the Panta API
1:32 What's next: calls from X
1:52 Conviction has a price

Built for the Colosseum Crypto World's Fair Hackathon · Panta API Sidetrack.
Not affiliated with the Premier League. Prediction markets carry real risk.

**Tags**
Panta, prediction markets, Fantasy Premier League, FPL, AI benchmark, AI forecasting, Solana, Colosseum, hackathon, Claude, GPT, Gemini, Grok, DeepSeek

---

## 2 · Pitch video (YouTube)

**Title**
Overline — Pitch | Colosseum Crypto World's Fair · Panta Sidetrack

**Description**
Who I am, what I'm building, and why I'm the one to build it.

I'm a solo builder from Nigeria and a Fantasy Premier League fan first. FPL gives you millions of opinions every week, and none of them cost anything. Prediction markets are the one place where being wrong costs you, and they can price things a sportsbook never will. I wanted to play that game. Nobody had built it, so I did.

Overline is an open study built on Panta: frontier AI models and public forecasters price the same FPL markets with real money. In round one, the models went 6 for 10. The fans went 0 for 12.

0:00 Who
0:13 Why this
0:29 What
0:51 Why me
1:05 What's next

▶ Live: https://fpl-y1ck.vercel.app/
▶ Code: https://github.com/yeziR4/fpl

---

## 3 · Project description (Colosseum / Superteam Earn)

**One-liner**
Overline puts a price on football opinions: frontier AI models and FPL fans trade the same Fantasy Premier League markets on Panta, with every call and every position on the record.

**Short description (~50 words)**
Overline is an open study built on the Panta API. For launch week we created three Fantasy Premier League markets on Panta. Five frontier AI models, each with its own wallet, and twelve fans from X called them in public. The fans went 0 for 12. The models went 6 for 10.

**Full description**

*The problem*
Every weekend, millions of Fantasy Premier League players are completely sure about something, and it costs them nothing to be wrong. AI benchmarks have the same flaw: a model is never made to pay for a bad forecast. Traditional sportsbooks don't help either. They will never offer a market on whether Saka scores 7+ fantasy points.

*What we built*
Overline uses prediction markets to make opinions cost something, and it runs entirely on Panta.
- **Markets:** we created three FPL player markets on Panta for Gameweek 6 (Saka 7+, Haaland 8+, João Pedro 8+). A generator picks lines where the crowd is likely to split.
- **AI models:** Claude, GPT, Gemini, Grok and DeepSeek each get their own wallet and $5, the same prompt, the same live price, and must state a probability and a reason before kickoff. Then they trade.
- **Fans:** fans call the same markets publicly on X. Six calls got a free $3 stake placed on Panta, in a wallet in the fan's name.
- **Settlement:** Panta settles against the official FPL data, and the site publishes every call, price, position and P&L.

*Results so far (Gameweek 6)*
- 47 replies to the launch post and 12 calls recorded word for word. Every one said YES.
- The fans went 0 for 12: Saka scored 2 against a line of 7, and Haaland 6 against a line of 8.
- The models went 6 for 10. Claude (+$5.77), Gemini (+$5.53) and GPT (+$3.17) finished in profit.
- 16 positions on Panta in total.

*How Panta is integrated*
- **Create markets:** `/marketquote` → `/marketbuild` → `/marketregister`
- **Read prices:** `/primaryorderquote`
- **Trade:** `/primaryorderbuild` → sign with the participant's own key → `/primaryordersubmit` → `/primaryorderverify`
- **Read positions and P&L:** from Panta's own pool figures

*What's next*
Gameweek 6 was round 1 of 38. Next, fans reply on X with their call and it becomes their own position on Panta, and later they can bet straight from X with X Money. More models as they ship, and more sports and leagues that sportsbooks can't cover. Market fees fund the next round's liquidity, so it keeps running.

*Links*
- Live: https://fpl-y1ck.vercel.app/
- Code: https://github.com/yeziR4/fpl
- Demo video: [YouTube link]
- Pitch video: [YouTube link]
