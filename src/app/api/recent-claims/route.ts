import { NextResponse } from "next/server";
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import {
  clientKey,
  isAllowedOrigin,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { withRpcFallback } from "@/lib/rpc";
import { PUMP_PROGRAM_ID } from "@/lib/pump-cashback";
import {
  LEDGER_DISPLAY_LIMIT,
  LEDGER_HISTORY_CAP,
} from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ClaimActionType =
  | "vacant_account"
  | "pump_cashback"
  | "burn_token"
  | "mixed";

export interface RecentClaim {
  signature: string;
  blockTime: number;
  wallet: string;
  accountsClosed: number;
  reclaimedLamports: number;
  action: ClaimActionType;
}

export interface LedgerStats {
  totalClaims: number;
  totalUsers: number;
  totalReclaimedLamports: number;
  totalAccountsClosed: number;
  claims24h: number;
  users24h: number;
  reclaimedLamports24h: number;
}

export interface LedgerResponse {
  configured: boolean;
  claims: RecentClaim[];
  stats: LedgerStats;
}

const EMPTY_STATS: LedgerStats = {
  totalClaims: 0,
  totalUsers: 0,
  totalReclaimedLamports: 0,
  totalAccountsClosed: 0,
  claims24h: 0,
  users24h: 0,
  reclaimedLamports24h: 0,
};

const EMPTY: LedgerResponse = {
  configured: false,
  claims: [],
  stats: EMPTY_STATS,
};

const LIMIT = 20;
const WINDOW_MS = 60_000;
const DAY_SEC = 86_400;

function programIdOf(ix: { programId?: unknown; program?: unknown }): string | null {
  const raw = ix.programId ?? ix.program;
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null && "toBase58" in raw) {
    try {
      return (raw as PublicKey).toBase58();
    } catch {
      return null;
    }
  }
  return String(raw);
}

function classifyAction(tx: ParsedTransactionWithMeta): {
  action: ClaimActionType | null;
  accountsClosed: number;
} {
  let accountsClosed = 0;
  let hasPump = false;
  const pumpId = PUMP_PROGRAM_ID.toBase58();

  const considerIx = (ix: {
    programId?: unknown;
    program?: unknown;
    parsed?: { type?: string };
  }) => {
    if (ix.parsed?.type === "closeAccount") {
      accountsClosed++;
    }
    const pid = programIdOf(ix);
    if (pid === pumpId) hasPump = true;
  };

  for (const ix of tx.transaction.message.instructions) {
    considerIx(ix as { programId?: unknown; parsed?: { type?: string } });
  }
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      considerIx(ix as { programId?: unknown; parsed?: { type?: string } });
    }
  }

  if (hasPump && accountsClosed > 0) return { action: "mixed", accountsClosed };
  if (hasPump) return { action: "pump_cashback", accountsClosed: 0 };
  if (accountsClosed > 0) return { action: "vacant_account", accountsClosed };
  return { action: null, accountsClosed: 0 };
}

/**
 * Public read-only ledger. Fee wallet history IS the database.
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

      type Sig = Awaited<
        ReturnType<typeof connection.getSignaturesForAddress>
      >[number];
      const allSigs: Sig[] = [];
      let before: string | undefined;
      while (allSigs.length < LEDGER_HISTORY_CAP) {
        const batch = await connection.getSignaturesForAddress(feeWallet, {
          limit: Math.min(100, LEDGER_HISTORY_CAP - allSigs.length),
          before,
        });
        if (batch.length === 0) break;
        allSigs.push(...batch);
        before = batch[batch.length - 1].signature;
        if (batch.length < 100) break;
      }

      const successful = allSigs.filter((s) => !s.err);
      // Parse up to 200 newest successful fee-wallet txs for stats + feed.
      const toParse = successful.slice(0, Math.min(successful.length, 200));

      const claims: RecentClaim[] = [];
      for (let offset = 0; offset < toParse.length; offset += 40) {
        const slice = toParse.slice(offset, offset + 40);
        const txs = await connection.getParsedTransactions(
          slice.map((s) => s.signature),
          { maxSupportedTransactionVersion: 0 }
        );

        for (let i = 0; i < txs.length; i++) {
          const tx = txs[i];
          if (!tx || tx.meta?.err) continue;

          const { action, accountsClosed } = classifyAction(tx);
          if (!action) continue;

          const keys = tx.transaction.message.accountKeys;
          const feePayerIndex = keys.findIndex((k) => k.signer);
          if (feePayerIndex === -1) continue;

          const pre = tx.meta?.preBalances?.[feePayerIndex] ?? 0;
          const post = tx.meta?.postBalances?.[feePayerIndex] ?? 0;
          const reclaimedLamports = post - pre;
          if (reclaimedLamports <= 0) continue;

          claims.push({
            signature: slice[i].signature,
            blockTime: tx.blockTime ?? slice[i].blockTime ?? 0,
            wallet: keys[feePayerIndex].pubkey.toBase58(),
            accountsClosed,
            reclaimedLamports,
            action,
          });
        }
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const users = new Set(claims.map((c) => c.wallet));
      const last24 = claims.filter(
        (c) => c.blockTime > 0 && nowSec - c.blockTime <= DAY_SEC
      );
      const users24 = new Set(last24.map((c) => c.wallet));

      const result: LedgerResponse = {
        configured: true,
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
