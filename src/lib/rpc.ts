import { Connection, clusterApiUrl, type Commitment } from "@solana/web3.js";

/** Solana Labs public mainnet RPC (rate-limited, no key). */
export const PUBLIC_RPC_URL = clusterApiUrl("mainnet-beta");

/**
 * Ordered RPC endpoints: public first (free), then Helius if configured.
 * Matches "try public for efficiency, fall back to paid RPC on failure."
 */
export function getRpcEndpoints(): string[] {
  const endpoints = [PUBLIC_RPC_URL];
  const helius = process.env.HELIUS_RPC_URL?.trim();
  if (helius && helius !== PUBLIC_RPC_URL) {
    endpoints.push(helius);
  }
  return endpoints;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * POST JSON-RPC to public first; on transport/rate-limit failure, try Helius.
 */
export async function fetchRpcWithFallback(
  body: unknown,
  init?: { signal?: AbortSignal }
): Promise<Response> {
  const endpoints = getRpcEndpoints();
  let lastError: unknown;

  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[i];
    const isLast = i === endpoints.length - 1;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: init?.signal,
      });

      if (!res.ok && isRetryableStatus(res.status) && !isLast) {
        // Drain body so the connection can close cleanly, then try next.
        await res.text().catch(() => undefined);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (isLast) throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All RPC endpoints failed");
}

/**
 * Run a Connection-backed operation against public first, then Helius.
 */
export async function withRpcFallback<T>(
  fn: (connection: Connection) => Promise<T>,
  commitment: Commitment = "confirmed"
): Promise<T> {
  const endpoints = getRpcEndpoints();
  let lastError: unknown;

  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[i];
    const isLast = i === endpoints.length - 1;
    try {
      const connection = new Connection(url, {
        commitment,
        disableRetryOnRateLimit: true,
      });
      return await fn(connection);
    } catch (err) {
      lastError = err;
      if (isLast) throw err;
      console.warn(
        `RPC failed on ${i === 0 ? "public" : "fallback"} endpoint, trying next…`,
        err instanceof Error ? err.message : err
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All RPC endpoints failed");
}
