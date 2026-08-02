import { NextResponse } from "next/server";
import {
  clientKey,
  isAllowedOrigin,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { isNeonConfigured } from "@/lib/db";
import {
  EMPTY_STATS,
  readLedgerSnapshot,
  syncLedgerFromChain,
  type ClaimActionType,
  type LedgerStats,
  type RecentClaim,
} from "@/lib/ledger-store";
import { withRpcFallback } from "@/lib/rpc";
import {
  LEDGER_DISPLAY_LIMIT,
  LEDGER_HISTORY_CAP,
  LEDGER_PARSE_LIMIT,
} from "@/lib/constants";
import { PublicKey } from "@solana/web3.js";
import { parseClaimFromTx } from "@/lib/ledger-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { ClaimActionType, LedgerStats, RecentClaim };

export interface LedgerResponse {
  configured: boolean;
  durable?: boolean;
  claims: RecentClaim[];
  stats: LedgerStats;
}

const EMPTY: LedgerResponse = {
  configured: false,
  durable: false,
  claims: [],
  stats: EMPTY_STATS,
};

const LIMIT = 20;
const WINDOW_MS = 60_000;

/**
 * Public ledger + stats.
 * Prefer Neon durable store (seed once, then incremental). Fallback: short RPC window.
 */
export async function GET(req: Request) {
  if (!isAllowedOrigin(req)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }

  const key = clientKey(req, "claims");
  const limited = rateLimit(key, LIMIT, WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      {
        ...EMPTY,
        configured: true,
        error: "Too many requests. Please wait.",
        retryAfterSec: limited.retryAfterSec,
      },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders(limited, LIMIT),
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const feeWalletAddress = process.env.NEXT_PUBLIC_FEE_WALLET?.trim();
  const forceSync =
    new URL(req.url).searchParams.get("sync") === "1";

  if (!feeWalletAddress) {
    return NextResponse.json(EMPTY, {
      headers: {
        ...rateLimitHeaders(limited, LIMIT),
        ...cacheHeaders(),
      },
    });
  }

  // —— Durable path (Neon) ——
  if (isNeonConfigured()) {
    try {
      await withRpcFallback(async (connection) => {
        await syncLedgerFromChain(connection, feeWalletAddress, {
          force: forceSync,
        });
      });

      const snapshot = await readLedgerSnapshot();
      return NextResponse.json(
        {
          configured: true,
          durable: true,
          claims: snapshot.claims,
          stats: snapshot.stats,
        } satisfies LedgerResponse,
        {
          headers: {
            ...rateLimitHeaders(limited, LIMIT),
            ...cacheHeaders(60),
          },
        }
      );
    } catch (err) {
      // Never leak connection / SQL details to clients
      console.error("recent-claims neon path failed");
      console.error(err instanceof Error ? err.message : "unknown error");
      // Fall through to RPC-only degraded mode
    }
  }

  // —— Fallback: short RPC window (no Neon / Neon error) ——
  try {
    const body = await withRpcFallback(async (connection) => {
      const feeWallet = new PublicKey(feeWalletAddress);
      const allSigs = await connection.getSignaturesForAddress(feeWallet, {
        limit: LEDGER_HISTORY_CAP,
      });
      const successful = allSigs.filter((s) => !s.err);
      const toParse = successful.slice(0, LEDGER_PARSE_LIMIT);

      const claims: RecentClaim[] = [];
      for (const info of toParse) {
        try {
          const tx = await connection.getParsedTransaction(info.signature, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          });
          const claim = parseClaimFromTx(
            info.signature,
            tx,
            info.blockTime ?? 0
          );
          if (claim) claims.push(claim);
        } catch {
          // skip
        }
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const users = new Set(claims.map((c) => c.wallet));
      const last24 = claims.filter(
        (c) => c.blockTime > 0 && nowSec - c.blockTime <= 86_400
      );
      const users24 = new Set(last24.map((c) => c.wallet));

      const result: LedgerResponse = {
        configured: true,
        durable: false,
        claims: claims.slice(0, LEDGER_DISPLAY_LIMIT),
        stats: {
          totalClaims: claims.length,
          totalUsers: users.size,
          totalReclaimedLamports: claims.reduce(
            (n, c) => n + c.reclaimedLamports,
            0
          ),
          totalAccountsClosed: claims.reduce(
            (n, c) => n + c.accountsClosed,
            0
          ),
          claims24h: last24.length,
          users24h: users24.size,
          reclaimedLamports24h: last24.reduce(
            (n, c) => n + c.reclaimedLamports,
            0
          ),
        },
      };
      return result;
    });

    return NextResponse.json(body, {
      headers: {
        ...rateLimitHeaders(limited, LIMIT),
        ...cacheHeaders(60),
      },
    });
  } catch (err) {
    console.error("recent-claims rpc fallback failed");
    console.error(err instanceof Error ? err.message : "unknown error");
    return NextResponse.json(
      { ...EMPTY, configured: true },
      {
        status: 200,
        headers: {
          ...rateLimitHeaders(limited, LIMIT),
          ...cacheHeaders(30),
        },
      }
    );
  }
}

function cacheHeaders(seconds = 60) {
  return {
    "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=120`,
  };
}
