import type { VercelRequest, VercelResponse } from "@vercel/node";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { isAuthorized } from "../lib/auth.js";

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== "POST") {
    response.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!isAuthorized(request)) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  const privateKey = process.env.TELEGRAPH_EVM_PRIVATE_KEY;
  if (!privateKey?.startsWith("0x")) {
    response.status(503).json({ error: "telegraph_wallet_not_configured" });
    return;
  }
  const playerName = clean(request.body?.playerName, 60);
  const market = clean(request.body?.label, 50);
  const gameweek = Number(request.body?.gameweek);
  if (!playerName || !market || !Number.isInteger(gameweek)) {
    response.status(400).json({ error: "invalid_request" });
    return;
  }

  try {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const client = x402Client.fromConfig({
      schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(toClientEvmSigner(account)) }],
    });
    const paidFetch = wrapFetchWithPayment(fetch, client);
    const engineUrl = (process.env.TELEGRAPH_ENGINE_URL ?? "http://13.237.89.59:8080").replace(/\/$/, "");
    const upstream = await paidFetch(`${engineUrl}/v1/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        query: `Assess ${playerName}'s chance of clearing ${market} in Fantasy Premier League gameweek ${gameweek}. Use current sports intelligence. Give a concise verdict and the key reason.`,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      response.status(502).json({ error: "telegraph_request_failed", status: upstream.status });
      return;
    }
    response.status(200).json({ ok: true, provider: "Telegraph", result: body });
  } catch (error) {
    console.error("Telegraph inference failed", error);
    response.status(502).json({ error: "telegraph_request_failed" });
  }
}

function clean(value: unknown, length: number): string {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}
