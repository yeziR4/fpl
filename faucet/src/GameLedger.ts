const STARTING_BALANCE = 1000;
const SEED_LIQUIDITY = 250;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type User = {
  username: string;
  salt: string;
  passwordHash: string;
  balance: number;
  staked: number;
  returned: number;
  predictions: number;
};

type Session = { username: string; expiresAt: number };
type Side = "yes" | "no";
type Bet = {
  id: string;
  username: string;
  marketId: string;
  playerName: string;
  label: string;
  side: Side;
  stake: number;
  placedAt: string;
  status: "open" | "won" | "lost";
  returnAmount: number;
};

export class GameLedger implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/signup") return this.signup(request);
      if (request.method === "POST" && url.pathname === "/login") return this.login(request);
      if (request.method === "POST" && url.pathname === "/logout") return this.logout(request);
      if (request.method === "GET" && url.pathname === "/me") return this.me(request);
      if (request.method === "POST" && url.pathname === "/bet") return this.bet(request);
      if (request.method === "POST" && url.pathname === "/settle") return this.settle(request);
      if (request.method === "GET" && url.pathname === "/market") return this.market(url);
      if (request.method === "GET" && url.pathname === "/leaderboard") return this.leaderboard();
      return response({ error: "not_found" }, 404);
    } catch (error) {
      console.error("GameLedger error", error);
      return response({ error: "internal_error" }, 500);
    }
  }

  private async signup(request: Request): Promise<Response> {
    const body = await readCredentials(request);
    if ("error" in body) return response({ error: body.error }, 400);
    const key = `user:${body.username}`;
    if (await this.state.storage.get(key)) return response({ error: "username_taken" }, 409);
    const salt = randomToken(16);
    const user: User = {
      username: body.username,
      salt,
      passwordHash: await hashPassword(body.password, salt),
      balance: STARTING_BALANCE,
      staked: 0,
      returned: 0,
      predictions: 0,
    };
    await this.state.storage.put(key, user);
    return this.createSession(user);
  }

  private async login(request: Request): Promise<Response> {
    const body = await readCredentials(request);
    if ("error" in body) return response({ error: body.error }, 400);
    const user = await this.state.storage.get<User>(`user:${body.username}`);
    if (!user || user.passwordHash !== (await hashPassword(body.password, user.salt))) {
      return response({ error: "invalid_credentials" }, 401);
    }
    return this.createSession(user);
  }

  private async createSession(user: User): Promise<Response> {
    const token = randomToken(32);
    await this.state.storage.put(`session:${token}`, {
      username: user.username,
      expiresAt: Date.now() + SESSION_TTL_MS,
    } satisfies Session);
    return response({ token, user: publicUser(user) });
  }

  private async logout(request: Request): Promise<Response> {
    const token = bearer(request);
    if (token) await this.state.storage.delete(`session:${token}`);
    return response({ ok: true });
  }

  private async me(request: Request): Promise<Response> {
    const user = await this.authenticatedUser(request);
    return user ? response({ user: publicUser(user) }) : response({ error: "unauthorized" }, 401);
  }

  private async bet(request: Request): Promise<Response> {
    const user = await this.authenticatedUser(request);
    if (!user) return response({ error: "unauthorized" }, 401);
    const body = (await request.json()) as Record<string, unknown>;
    const marketId = cleanText(body.marketId, 100);
    const playerName = cleanText(body.playerName, 60);
    const label = cleanText(body.label, 40);
    const side = body.side === "yes" || body.side === "no" ? body.side : null;
    const stake = typeof body.stake === "number" ? Math.round(body.stake * 100) / 100 : NaN;
    if (!marketId || !playerName || !label || !side || !Number.isFinite(stake) || stake < 1) {
      return response({ error: "invalid_bet" }, 400);
    }
    if (stake > user.balance) return response({ error: "insufficient_credits" }, 400);
    const existingBets = await this.state.storage.list<Bet>({ prefix: `bet:${marketId}:${user.username}:`, limit: 1 });
    if (existingBets.size > 0) return response({ error: "already_predicted" }, 409);

    const marketKey = `market:${marketId}`;
    const totals = (await this.state.storage.get<{ yes: number; no: number }>(marketKey)) ?? {
      yes: SEED_LIQUIDITY,
      no: SEED_LIQUIDITY,
    };
    totals[side] = Math.round((totals[side] + stake) * 100) / 100;
    user.balance = Math.round((user.balance - stake) * 100) / 100;
    user.staked = Math.round((user.staked + stake) * 100) / 100;
    user.predictions += 1;
    const id = crypto.randomUUID();
    const bet: Bet = {
      id,
      username: user.username,
      marketId,
      playerName,
      label,
      side,
      stake,
      placedAt: new Date().toISOString(),
      status: "open",
      returnAmount: 0,
    };
    await this.state.storage.put({
      [`user:${user.username}`]: user,
      [marketKey]: totals,
      [`bet:${marketId}:${user.username}:${id}`]: bet,
    });
    return response({ ok: true, user: publicUser(user), totals, bet });
  }

  private async market(url: URL): Promise<Response> {
    const marketId = url.searchParams.get("id")?.slice(0, 100);
    if (!marketId) return response({ error: "market_required" }, 400);
    const totals = (await this.state.storage.get<{ yes: number; no: number }>(`market:${marketId}`)) ?? {
      yes: SEED_LIQUIDITY,
      no: SEED_LIQUIDITY,
    };
    return response({ totals });
  }

  private async leaderboard(): Promise<Response> {
    const users = await this.state.storage.list<User>({ prefix: "user:" });
    return response({
      leaders: [...users.values()]
        .map(publicUser)
        .sort((a, b) => b.netProfit - a.netProfit || b.balance - a.balance)
        .slice(0, 100),
    });
  }

  private async settle(request: Request): Promise<Response> {
    const body = (await request.json()) as Record<string, unknown>;
    const marketId = cleanText(body.marketId, 100);
    const outcome = body.outcome === "yes" || body.outcome === "no" ? body.outcome : null;
    if (!marketId || !outcome) return response({ error: "invalid_settlement" }, 400);
    const settledKey = `settled:${marketId}`;
    if (await this.state.storage.get(settledKey)) return response({ ok: true, alreadySettled: true });
    const totals = (await this.state.storage.get<{ yes: number; no: number }>(`market:${marketId}`)) ?? {
      yes: SEED_LIQUIDITY,
      no: SEED_LIQUIDITY,
    };
    const bets = await this.state.storage.list<Bet>({ prefix: `bet:${marketId}:` });
    const updates: Record<string, unknown> = { [settledKey]: { outcome, settledAt: new Date().toISOString() } };
    for (const [key, bet] of bets) {
      if (bet.status !== "open") continue;
      const user = await this.state.storage.get<User>(`user:${bet.username}`);
      if (!user) continue;
      bet.status = bet.side === outcome ? "won" : "lost";
      bet.returnAmount = bet.status === "won"
        ? Math.round(((bet.stake * (totals.yes + totals.no)) / totals[outcome]) * 100) / 100
        : 0;
      user.returned = Math.round((user.returned + bet.returnAmount) * 100) / 100;
      user.balance = Math.round((user.balance + bet.returnAmount) * 100) / 100;
      updates[key] = bet;
      updates[`user:${user.username}`] = user;
    }
    await this.state.storage.put(updates);
    return response({ ok: true, outcome });
  }

  private async authenticatedUser(request: Request): Promise<User | null> {
    const token = bearer(request);
    if (!token) return null;
    const session = await this.state.storage.get<Session>(`session:${token}`);
    if (!session || session.expiresAt < Date.now()) {
      if (session) await this.state.storage.delete(`session:${token}`);
      return null;
    }
    return (await this.state.storage.get<User>(`user:${session.username}`)) ?? null;
  }
}

function publicUser(user: User) {
  return {
    username: user.username,
    balance: user.balance,
    staked: user.staked,
    returned: user.returned,
    predictions: user.predictions,
    netProfit: Math.round((user.returned - user.staked) * 100) / 100,
  };
}

async function readCredentials(request: Request): Promise<{ username: string; password: string } | { error: string }> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return { error: "invalid_json" };
  }
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return { error: "invalid_username" };
  if (password.length < 8 || password.length > 128) return { error: "invalid_password" };
  return { username, password };
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexBytes(salt), iterations: 120_000 },
    material,
    256,
  );
  return bytesHex(new Uint8Array(bits));
}

function randomToken(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesHex(value);
}

function bytesHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{2}/g)?.map((value) => Number.parseInt(value, 16)) ?? []);
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
