import { NextResponse } from "next/server";
import {
  PublicKey,
  SystemProgram,
  type Connection,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { FEE_WALLET_ADDRESS, SOLSCAN_TX } from "@/lib/constants";
import { PUMP_PROGRAM_ID } from "@/lib/pump-cashback";
import {
  clientKey,
  isAllowedOrigin,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { withRpcFallback } from "@/lib/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IP_LIMIT = 12;
const WALLET_LIMIT = 6;
const WINDOW_MS = 60_000;
/** Cap RPC work — enough for a meaningful cumulative total without spam. */
const SIG_CAP = 40;
const PARSE_CAP = 30;

export interface ReferralEarningRow {
  signature: string;
  blockTime: number;
  lamports: number;
  claimant: string;
  url: string;
}

export interface ReferralEarningsResponse {
  wallet: string;
  totalLamports: number;
  payoutCount: number;
  recent: ReferralEarningRow[];
  truncated: boolean;
}

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

function isClaimLikeTx(tx: ParsedTransactionWithMeta): boolean {
  let accountsClosed = 0;
  let hasPump = false;
  const pumpId = PUMP_PROGRAM_ID.toBase58();

  const consider = (ix: {
    programId?: unknown;
    program?: unknown;
    parsed?: { type?: string };
  }) => {
    if (ix.parsed?.type === "closeAccount") accountsClosed++;
    const pid = programIdOf(ix);
    if (pid === pumpId) hasPump = true;
  };

  for (const ix of tx.transaction.message.instructions) {
    consider(ix as { programId?: unknown; parsed?: { type?: string } });
  }
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      consider(ix as { programId?: unknown; parsed?: { type?: string } });
    }
  }

  return accountsClosed > 0 || hasPump;
}

/** Lamports credited to `wallet` via system transfers in this tx. */
function systemTransferInTo(
  tx: ParsedTransactionWithMeta,
  wallet: string
): number {
  let total = 0;
  const consider = (ix: {
    programId?: unknown;
    program?: unknown;
    parsed?: {
      type?: string;
      info?: { destination?: string; lamports?: number | string };
    };
  }) => {
    const pid = programIdOf(ix);
    if (pid !== SystemProgram.programId.toBase58()) return;
    if (ix.parsed?.type !== "transfer") return;
    const dest = ix.parsed.info?.destination;
    const lamports = Number(ix.parsed.info?.lamports ?? 0);
    if (dest === wallet && Number.isFinite(lamports) && lamports > 0) {
      total += lamports;
    }
  };

  for (const ix of tx.transaction.message.instructions) {
    consider(ix as never);
  }
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      consider(ix as never);
    }
  }
  return total;
}

function feeWalletReceived(
  tx: ParsedTransactionWithMeta,
  feeWallet: string
): boolean {
  return systemTransferInTo(tx, feeWallet) > 0;
}

async function getParsedOne(
  connection: Connection,
  signature: string
): Promise<ParsedTransactionWithMeta | null> {
  try {
    return await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
  } catch {
    return null;
  }
}

/**
 * On-chain referral earnings for a wallet.
 * Counts SOL system transfers TO the referrer in MySolClaim-like txs
 * that also tip the platform fee wallet — never platform profit.
 */
export async function GET(req: Request) {
  if (!isAllowedOrigin(req)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }

  const ipLimited = rateLimit(
    clientKey(req, "ref-earn"),
    IP_LIMIT,
    WINDOW_MS
  );
  if (!ipLimited.ok) {
    return NextResponse.json(
      {
        error: "Too many requests. Please wait.",
        retryAfterSec: ipLimited.retryAfterSec,
      },
      { status: 429, headers: rateLimitHeaders(ipLimited, IP_LIMIT) }
    );
  }

  const walletRaw = new URL(req.url).searchParams.get("wallet")?.trim() ?? "";
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletRaw);
  } catch {
    return NextResponse.json(
      { error: "Invalid wallet address." },
      { status: 400, headers: rateLimitHeaders(ipLimited, IP_LIMIT) }
    );
  }

  const walletStr = wallet.toBase58();
  const walletLimited = rateLimit(
    `ref-earn-wallet:${walletStr}`,
    WALLET_LIMIT,
    WINDOW_MS
  );
  if (!walletLimited.ok) {
    return NextResponse.json(
      {
        error: "This wallet was queried too recently. Wait a moment.",
        retryAfterSec: walletLimited.retryAfterSec,
      },
      { status: 429, headers: rateLimitHeaders(walletLimited, WALLET_LIMIT) }
    );
  }

  if (!FEE_WALLET_ADDRESS) {
    const empty: ReferralEarningsResponse = {
      wallet: walletStr,
      totalLamports: 0,
      payoutCount: 0,
      recent: [],
      truncated: false,
    };
    return NextResponse.json(empty, {
      headers: {
        ...rateLimitHeaders(ipLimited, IP_LIMIT),
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    const body = await withRpcFallback(async (connection) => {
      const sigs = await connection.getSignaturesForAddress(wallet, {
        limit: SIG_CAP,
      });
      const successful = sigs.filter((s) => !s.err).slice(0, PARSE_CAP);

      const recent: ReferralEarningRow[] = [];
      let totalLamports = 0;
      let payoutCount = 0;

      for (const info of successful) {
        const tx = await getParsedOne(connection, info.signature);
        if (!tx || tx.meta?.err) continue;
        if (!isClaimLikeTx(tx)) continue;
        if (!feeWalletReceived(tx, FEE_WALLET_ADDRESS)) continue;

        const tip = systemTransferInTo(tx, walletStr);
        if (tip <= 0) continue;

        const keys = tx.transaction.message.accountKeys;
        const feePayer = keys.find((k) => k.signer);
        const claimant = feePayer?.pubkey.toBase58() ?? "unknown";
        if (claimant === walletStr) continue;

        totalLamports += tip;
        payoutCount += 1;
        if (recent.length < 12) {
          recent.push({
            signature: info.signature,
            blockTime: tx.blockTime ?? info.blockTime ?? 0,
            lamports: tip,
            claimant,
            url: SOLSCAN_TX(info.signature),
          });
        }
      }

      const result: ReferralEarningsResponse = {
        wallet: walletStr,
        totalLamports,
        payoutCount,
        recent,
        truncated: sigs.length >= SIG_CAP,
      };
      return result;
    });

    return NextResponse.json(body, {
      headers: {
        ...rateLimitHeaders(ipLimited, IP_LIMIT),
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (err) {
    console.error("referral earnings failed:", err);
    return NextResponse.json(
      {
        wallet: walletStr,
        totalLamports: 0,
        payoutCount: 0,
        recent: [],
        truncated: false,
        error: "Could not load earnings. Try again shortly.",
      },
      {
        status: 200,
        headers: {
          ...rateLimitHeaders(ipLimited, IP_LIMIT),
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
