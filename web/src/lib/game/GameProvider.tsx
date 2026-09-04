"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type GameUser = {
  username: string;
  balance: number;
  staked: number;
  returned: number;
  predictions: number;
  netProfit: number;
};

type GameContextValue = {
  user: GameUser | null;
  loading: boolean;
  login: (username: string, password: string, create: boolean) => Promise<string | null>;
  logout: () => Promise<void>;
  placePrediction: (input: PredictionInput) => Promise<{ error: string | null; telegraph: unknown }>;
};

type PredictionInput = {
  marketId: string;
  playerName: string;
  label: string;
  side: "yes" | "no";
  stake: number;
};

const GameContext = createContext<GameContextValue | null>(null);
const TOKEN_KEY = "overline-session";

export function GameProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<GameUser | null>(null);
  const [loading, setLoading] = useState(true);
  const baseUrl = process.env.NEXT_PUBLIC_FAUCET_URL;

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!baseUrl || !token) {
      setLoading(false);
      return;
    }
    void gameFetch<{ user: GameUser }>(baseUrl, "/game/me", { token })
      .then((result) => setUser(result.user))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, [baseUrl]);

  const login = useCallback(async (username: string, password: string, create: boolean) => {
    if (!baseUrl) return "The game service is not configured yet.";
    try {
      const result = await gameFetch<{ token: string; user: GameUser }>(
        baseUrl,
        create ? "/game/signup" : "/game/login",
        { method: "POST", body: { username, password } },
      );
      localStorage.setItem(TOKEN_KEY, result.token);
      setUser(result.user);
      return null;
    } catch (error) {
      return friendlyError(error);
    }
  }, [baseUrl]);

  const logout = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    if (baseUrl && token) {
      await gameFetch(baseUrl, "/game/logout", { method: "POST", token }).catch(() => undefined);
    }
  }, [baseUrl]);

  const placePrediction = useCallback(async (input: PredictionInput) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!baseUrl || !token) return { error: "Sign in to make a prediction.", telegraph: null };
    try {
      const result = await gameFetch<{ user: GameUser; telegraph?: unknown }>(baseUrl, "/game/bet", {
        method: "POST",
        token,
        body: input,
      });
      setUser(result.user);
      return { error: null, telegraph: result.telegraph ?? null };
    } catch (error) {
      return { error: friendlyError(error), telegraph: null };
    }
  }, [baseUrl]);

  const value = useMemo(() => ({ user, loading, login, logout, placePrediction }), [user, loading, login, logout, placePrediction]);
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const context = useContext(GameContext);
  if (!context) throw new Error("useGame must be used inside GameProvider");
  return context;
}

async function gameFetch<T = unknown>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "request_failed");
  return payload;
}

function friendlyError(error: unknown): string {
  const code = error instanceof Error ? error.message : "request_failed";
  return ({
    username_taken: "That username is already taken.",
    invalid_credentials: "Incorrect username or password.",
    invalid_username: "Use 3–20 letters, numbers or underscores.",
    invalid_password: "Password must contain at least 8 characters.",
    insufficient_credits: "You do not have enough credits.",
    invalid_bet: "Enter a valid prediction of at least 1 credit.",
  } as Record<string, string>)[code] ?? "Something went wrong. Please try again.";
}
