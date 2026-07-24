import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { findEmptyTokenAccounts } from "@/lib/scan";
import {
  clientKey,
  isAllowedOrigin,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { withRpcFallback } from "@/lib/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 8;
const WINDOW_MS = 60_000;

/**
 * Rate-limited empty-account scan.
 * Tries public Solana RPC first, then HELIUS_RPC_URL if configured.
 */
export async function GET(req: Request) {
  if (!isAllowedOrigin(req)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }

  const key = clientKey(req, "scan");
  const limited = rateLimit(key, LIMIT, WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      {
        error: "Too many scans. Slow down and try again shortly.",
        retryAfterSec: limited.retryAfterSec,
      },
      {
        status: 429,
        headers: rateLimitHeaders(limited, LIMIT),
      }
    );
  }

  const { searchParams } = new URL(req.url);
  const ownerStr = searchParams.get("owner")?.trim() ?? "";

  let owner: PublicKey;
  try {
    owner = new PublicKey(ownerStr);
  } catch {
    return NextResponse.json(
      { error: "Invalid wallet address." },
      { status: 400, headers: rateLimitHeaders(limited, LIMIT) }
    );
  }

  const walletLimited = rateLimit(`scan-wallet:${owner.toBase58()}`, 6, WINDOW_MS);
  if (!walletLimited.ok) {
    return NextResponse.json(
      {
        error: "This wallet was scanned too recently. Wait a moment.",
        retryAfterSec: walletLimited.retryAfterSec,
      },
      {
        status: 429,
        headers: rateLimitHeaders(walletLimited, 6),
      }
    );
  }

  try {
    const accounts = await withRpcFallback((connection) =>
      findEmptyTokenAccounts(connection, owner)
    );
    return NextResponse.json(
      { accounts },
      {
        headers: {
          ...rateLimitHeaders(limited, LIMIT),
          "Cache-Control": "private, no-store",
        },
      }
    );
  } catch (err) {
    console.error("scan failed:", err);
    return NextResponse.json(
      { error: "Scan failed. Please try again shortly." },
      { status: 502, headers: rateLimitHeaders(limited, LIMIT) }
    );
  }
}
