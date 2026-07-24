import { NextResponse } from "next/server";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { findEmptyTokenAccounts } from "@/lib/scan";
import {
  clientKey,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 8; // scans per window
const WINDOW_MS = 60_000;

/**
 * Rate-limited empty-account scan.
 * Keeps heavy RPC off anonymous browser free-for-alls and protects
 * the server-side Helius key.
 */
export async function GET(req: Request) {
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

  // Per-wallet throttle (same IP can still only scan a given wallet so often).
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

  const rpcUrl = process.env.HELIUS_RPC_URL || clusterApiUrl("mainnet-beta");

  try {
    const connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
    });
    const accounts = await findEmptyTokenAccounts(connection, owner);
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
