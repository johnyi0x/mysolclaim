import { NextResponse } from "next/server";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

export interface RecentClaim {
  signature: string;
  /** Unix seconds. */
  blockTime: number;
  /** Wallet that performed the claim (fee payer). */
  wallet: string;
  /** Number of token accounts closed in this transaction. */
  accountsClosed: number;
  /** Net lamports the user's wallet gained (after all fees). */
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

/**
 * Public, read-only ledger. The fee wallet's on-chain history IS the
 * database: every claim includes a fee transfer to the fee wallet, so
 * listing its signatures reconstructs all claims. No user data stored.
 */
export async function GET() {
  const feeWalletAddress = process.env.NEXT_PUBLIC_FEE_WALLET;
  const rpcUrl =
    process.env.HELIUS_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    clusterApiUrl("mainnet-beta");

  if (!feeWalletAddress) {
    return NextResponse.json(EMPTY, { headers: cacheHeaders() });
  }

  try {
    const connection = new Connection(rpcUrl, "confirmed");
    const feeWallet = new PublicKey(feeWalletAddress);

    const signatures = await connection.getSignaturesForAddress(feeWallet, {
      limit: 200,
    });
    const successful = signatures.filter((s) => !s.err);

    const txs = await connection.getParsedTransactions(
      successful.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0 }
    );

    const claims: RecentClaim[] = [];

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if (!tx || tx.meta?.err) continue;

      // Count token account closes in this transaction.
      let accountsClosed = 0;
      for (const ix of tx.transaction.message.instructions) {
        if ("parsed" in ix && ix.parsed?.type === "closeAccount") {
          accountsClosed++;
        }
      }
      if (accountsClosed === 0) continue; // not a claim tx (random transfer etc.)

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

    const body: LedgerResponse = {
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

    return NextResponse.json(body, { headers: cacheHeaders() });
  } catch (err) {
    console.error("recent-claims failed:", err);
    return NextResponse.json(
      { ...EMPTY, configured: true },
      { status: 200, headers: cacheHeaders(30) }
    );
  }
}

function cacheHeaders(seconds = 60) {
  return {
    "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=300`,
  };
}
