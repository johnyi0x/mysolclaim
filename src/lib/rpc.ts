import { Connection, clusterApiUrl, type Commitment } from "@solana/web3.js";

/** Solana Labs public mainnet RPC (rate-limited, no key). */
export const PUBLIC_RPC_URL = clusterApiUrl("mainnet-beta");

/**
 * Ordered RPC endpoints: public first (free), then Helius if configured.
 */
export function getRpcEndpoints(): string[] {
  const endpoints = [PUBLIC_RPC_URL];
  const helius = process.env.HELIUS_RPC_URL?.trim();
  if (helius && helius !== PUBLIC_RPC_URL) {
    endpoints.push(helius);
  }
  return endpoints;
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRetryableRpcMessage(message: unknown): boolean {
  if (typeof message !== "string") return false;
  const m = message.toLowerCase();
  return (
    m.includes("too many requests") ||
    m.includes("rate limit") ||
    m.includes("429") ||
    // Free Helius rejects JSON-RPC batches — we unbatch, but treat as retryable if seen.
    m.includes("batch requests are only available")
  );
}

function isJsonRpcBatch(body: unknown): body is unknown[] {
  return Array.isArray(body);
}

/**
 * Custom fetch for @solana/web3.js Connection.
 * Splits JSON-RPC batch arrays into sequential single requests so free Helius works.
 */
export function createNoBatchFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const rawBody = init?.body;
    if (rawBody == null) {
      return baseFetch(input, init);
    }

    const text =
      typeof rawBody === "string"
        ? rawBody
        : rawBody instanceof Uint8Array
          ? new TextDecoder().decode(rawBody)
          : String(rawBody);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return baseFetch(input, init);
    }

    if (!isJsonRpcBatch(parsed)) {
      return baseFetch(input, init);
    }

    // Sequential singles — never POST a JSON array to the provider.
    const results: unknown[] = [];
    for (const call of parsed) {
      const res = await baseFetch(input, {
        ...init,
        body: JSON.stringify(call),
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          "Content-Type": "application/json",
        },
      });
      const json = await res.json().catch(() => ({
        jsonrpc: "2.0",
        error: { code: -32000, message: `Upstream HTTP ${res.status}` },
        id: null,
      }));
      results.push(json);
    }

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

async function postRpcOnce(
  url: string,
  body: unknown,
  init?: { signal?: AbortSignal }
): Promise<{ response: Response; text: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: init?.signal,
  });
  const text = await response.text();
  return { response, text };
}

function shouldTryNextEndpoint(
  httpStatus: number,
  responseText: string,
  isLast: boolean
): boolean {
  if (isLast) return false;
  if (isRetryableHttpStatus(httpStatus)) return true;
  try {
    const json = JSON.parse(responseText) as {
      error?: { message?: string; code?: number };
    };
    if (json.error && isRetryableRpcMessage(json.error.message)) return true;
    if (json.error?.code === -32403) return true; // Helius batch / plan gate
  } catch {
    // ignore parse errors
  }
  return false;
}

/**
 * POST one JSON-RPC call (object, not array) to public first, then Helius.
 */
async function fetchSingleRpcWithFallback(
  body: unknown,
  init?: { signal?: AbortSignal }
): Promise<Response> {
  const endpoints = getRpcEndpoints();
  let lastError: unknown;

  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[i];
    const isLast = i === endpoints.length - 1;
    try {
      const { response, text } = await postRpcOnce(url, body, init);

      if (shouldTryNextEndpoint(response.status, text, isLast)) {
        console.warn(
          `RPC failed on ${i === 0 ? "public" : "fallback"} (${response.status}), trying next…`
        );
        continue;
      }

      return new Response(text, {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      lastError = err;
      if (isLast) throw err;
      console.warn(
        `RPC network error on ${i === 0 ? "public" : "fallback"}, trying next…`,
        err instanceof Error ? err.message : err
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All RPC endpoints failed");
}

/**
 * POST JSON-RPC to public first; on rate-limit / plan errors, try Helius.
 * JSON-RPC batches are always split into single requests (free-plan safe).
 */
export async function fetchRpcWithFallback(
  body: unknown,
  init?: { signal?: AbortSignal }
): Promise<Response> {
  if (isJsonRpcBatch(body)) {
    const results: unknown[] = [];
    for (const call of body) {
      const res = await fetchSingleRpcWithFallback(call, init);
      const json = await res.json().catch(() => ({
        jsonrpc: "2.0",
        error: { code: -32000, message: `Upstream HTTP ${res.status}` },
        id: null,
      }));
      results.push(json);
    }
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return fetchSingleRpcWithFallback(body, init);
}

export function createServerConnection(
  url: string,
  commitment: Commitment = "confirmed"
): Connection {
  return new Connection(url, {
    commitment,
    disableRetryOnRateLimit: true,
    fetch: createNoBatchFetch(),
  });
}

/**
 * Run a Connection-backed operation against public first, then Helius.
 * Connections never send JSON-RPC batches (free Helius compatible).
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
      const connection = createServerConnection(url, commitment);
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
