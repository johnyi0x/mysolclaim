import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  clientKey,
  isAllowedOrigin,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { withRpcFallback } from "@/lib/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface RecentClaim {
  signature: string;
  blockTime: number;
  wallet: string;
  accountsClosed: number;
  reclaimedLamports: number;
}

export interface LedgerResponse {
  configured: boolean;
  claims: RecentClaim[];
  stats: {
    totalClaims: number;
    totalAccountsClosed: number;
    totalReclaimedLamports: number;
  };
}

const EMPTY: LedgerResponse = {
  configured: false,
  claims: [],
  stats: { totalClaims: 0, totalAccountsClosed: 0, totalReclaimedLamports: 0 },
};

const LIMIT = 20;
const WINDOW_MS = 60_000;

/**
 * Public read-only ledger. Fee wallet history IS the database.
 * Public RPC first, Helius fallback if configured.
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

  const feeWalletAddress = process.env.NEXT_PUBLIC_FEE_WALLET;

  if (!feeWalletAddress) {
    return NextResponse.json(EMPTY, {
      headers: {
        ...rateLimitHeaders(limited, LIMIT),
        ...cacheHeaders(),
      },
    });
  }

  try {
    const body = await withRpcFallback(async (connection) => {
      const feeWallet = new PublicKey(feeWalletAddress);

      const signatures = await connection.getSignaturesForAddress(feeWallet, {
        limit: 80,
      });
      const successful = signatures.filter((s) => !s.err).slice(0, 40);

      const txs = await connection.getParsedTransactions(
        successful.map((s) => s.signature),
        { maxSupportedTransactionVersion: 0 }
      );

      const claims: RecentClaim[] = [];

      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i];
        if (!tx || tx.meta?.err) continue;

        let accountsClosed = 0;
        for (const ix of tx.transaction.message.instructions) {
          if ("parsed" in ix && ix.parsed?.type === "closeAccount") {
            accountsClosed++;
          }
        }
        if (accountsClosed === 0) continue;

        const keys = tx.transaction.message.accountKeys;
        const feePayerIndex = keys.findIndex((k) => k.signer);
        if (feePayerIndex === -1) continue;

        const pre = tx.meta?.preBalances?.[feePayerIndex] ?? 0;
        const post = tx.meta?.postBalances?.[feePayerIndex] ?? 0;
        const reclaimedLamports = post - pre;
        if (reclaimedLamports <= 0) continue;

        claims.push({
          signature: successful[i].signature,
          blockTime: tx.blockTime ?? successful[i].blockTime ?? 0,
          wallet: keys[feePayerIndex].pubkey.toBase58(),
          accountsClosed,
          reclaimedLamports,
        });
      }

      const result: LedgerResponse = {
        configured: true,
        claims: claims.slice(0, 20),
        stats: {
          totalClaims: claims.length,
          totalAccountsClosed: claims.reduce((n, c) => n + c.accountsClosed, 0),
          totalReclaimedLamports: claims.reduce(
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
    console.error("recent-claims failed:", err);
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
    "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=300`,
  };
}
