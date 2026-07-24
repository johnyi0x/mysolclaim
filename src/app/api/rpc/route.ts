import { NextResponse } from "next/server";
import {
  clientKey,
  isAllowedOrigin,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { fetchRpcWithFallback } from "@/lib/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Allow-list of JSON-RPC methods the browser may call through this proxy.
 * Heavy / abusive methods are blocked so a scraped endpoint can't burn
 * your entire Helius quota via getProgramAccounts spam etc.
 */
const ALLOWED_METHODS = new Set([
  "getLatestBlockhash",
  "getRecentPrioritizationFees",
  "getFeeForMessage",
  "getSignatureStatuses",
  "getSignatureStatus",
  "getTransaction",
  "getParsedTransaction",
  "simulateTransaction",
  "sendTransaction",
  "getAccountInfo",
  "getBalance",
  "getMultipleAccounts",
  "getMinimumBalanceForRentExemption",
  "getBlockHeight",
  "getEpochInfo",
  "getHealth",
  "getVersion",
  "getSlot",
]);

const LIMIT = 120;
const WINDOW_MS = 60_000;

/**
 * Server-side Solana RPC proxy.
 * Tries public RPC first, then HELIUS_RPC_URL if public fails / rate-limits.
 * The Helius key never reaches the browser.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Origin not allowed" },
        id: null,
      },
      { status: 403 }
    );
  }

  const key = clientKey(req, "rpc");
  const limited = rateLimit(key, LIMIT, WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: `Rate limited. Retry in ${limited.retryAfterSec}s.`,
        },
        id: null,
      },
      {
        status: 429,
        headers: rateLimitHeaders(limited, LIMIT),
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      },
      { status: 400, headers: rateLimitHeaders(limited, LIMIT) }
    );
  }

  const calls = Array.isArray(body) ? body : [body];
  for (const call of calls) {
    const methodName =
      call && typeof call === "object" && "method" in call
        ? String((call as { method: string }).method)
        : "";
    if (!ALLOWED_METHODS.has(methodName)) {
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32601,
            message: `Method not allowed: ${methodName || "(missing)"}`,
          },
          id:
            call && typeof call === "object" && "id" in call
              ? (call as { id: unknown }).id
              : null,
        },
        { status: 403, headers: rateLimitHeaders(limited, LIMIT) }
      );
    }
  }

  try {
    const upstreamRes = await fetchRpcWithFallback(body);
    const text = await upstreamRes.text();
    return new NextResponse(text, {
      status: upstreamRes.status,
      headers: {
        "Content-Type": "application/json",
        ...rateLimitHeaders(limited, LIMIT),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("rpc proxy failed:", err);
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Upstream RPC unavailable" },
        id: null,
      },
      { status: 502, headers: rateLimitHeaders(limited, LIMIT) }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: true, proxy: "mysolclaim-rpc", allowed: [...ALLOWED_METHODS] },
    { status: 200 }
  );
}
