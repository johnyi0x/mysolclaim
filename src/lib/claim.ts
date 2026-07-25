import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { createCloseAccountInstruction } from "@solana/spl-token";
import { CLOSES_PER_TX, FEE_PERCENT, FEE_WALLET } from "./constants";
import {
  buildPumpCashbackInstructions,
  type PumpCashbackOpportunity,
} from "./pump-cashback";
import { splitServiceFee } from "./referral";
import type { EmptyTokenAccount } from "./scan";

export type ClaimActionType = "vacant_account" | "pump_cashback";

export interface ClaimBatch {
  transaction: Transaction;
  accounts: EmptyTokenAccount[];
  /** Total rent / reclaimable (lamports) refunded to the user by this batch. */
  rentLamports: number;
  /** Total service fee (platform + referrer cuts). */
  feeLamports: number;
  platformFeeLamports: number;
  referrerFeeLamports: number;
  action: ClaimActionType;
  blockhash: string;
  lastValidBlockHeight: number;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function computeFee(rentLamports: number): number {
  return Math.floor((rentLamports * FEE_PERCENT) / 100);
}

/**
 * Append platform (+ optional referrer) fee transfers.
 * Referral cut comes from the service fee — referred user does not pay extra.
 */
async function appendFeeTransfer(
  connection: Connection,
  tx: Transaction,
  user: PublicKey,
  reclaimableLamports: number,
  referrer: PublicKey | null
): Promise<{
  totalFee: number;
  platformFee: number;
  referrerFee: number;
}> {
  if (!FEE_WALLET || FEE_PERCENT <= 0 || reclaimableLamports <= 0) {
    return { totalFee: 0, platformFee: 0, referrerFee: 0 };
  }

  let feeLamports = computeFee(reclaimableLamports);

  let rent0 = 890_880;
  try {
    rent0 = await connection.getMinimumBalanceForRentExemption(0);
  } catch {
    // fallback
  }

  let feeWalletReady = true;
  try {
    const feeInfo = await connection.getAccountInfo(FEE_WALLET, "confirmed");
    if (!feeInfo) {
      feeWalletReady = false;
      feeLamports = Math.max(feeLamports, rent0);
    } else if (feeInfo.lamports < rent0) {
      feeWalletReady = false;
      feeLamports = Math.max(feeLamports, rent0 - feeInfo.lamports);
    }
  } catch {
    feeWalletReady = true;
  }

  const safeFee = Math.min(feeLamports, reclaimableLamports);

  if (!feeWalletReady && safeFee < rent0) {
    throw new Error(
      `Fee wallet is not initialized on-chain and this claim (${safeFee} lamports fee) is too small to create it (needs ≥ ${rent0}). Send ~0.001 SOL to your fee wallet once, then retry.`
    );
  }

  // Until platform fee wallet is rent-safe, skip referral split (all → platform).
  const useReferrer = Boolean(referrer && feeWalletReady);

  let { platformLamports, referrerLamports } = splitServiceFee(
    safeFee,
    useReferrer
  );

  // If referrer wallet is missing / under-rented and cut is too small to create it,
  // skip referral this tx (avoid InsufficientFundsForRent) — all fee → platform.
  if (referrer && referrerLamports > 0) {
    try {
      const refInfo = await connection.getAccountInfo(referrer, "confirmed");
      if (!refInfo && referrerLamports < rent0) {
        platformLamports += referrerLamports;
        referrerLamports = 0;
      } else if (refInfo && refInfo.lamports < rent0) {
        const need = rent0 - refInfo.lamports;
        if (referrerLamports < need) {
          platformLamports += referrerLamports;
          referrerLamports = 0;
        }
      }
    } catch {
      // If we cannot read referrer, still attempt the tip (wallet usually exists).
    }
  }

  if (platformLamports > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: FEE_WALLET,
        lamports: platformLamports,
      })
    );
  }

  if (referrer && referrerLamports > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: referrer,
        lamports: referrerLamports,
      })
    );
  }

  return {
    totalFee: platformLamports + referrerLamports,
    platformFee: platformLamports,
    referrerFee: referrerLamports,
  };
}

export async function buildPumpCashbackTransaction(
  connection: Connection,
  user: PublicKey,
  opportunity: PumpCashbackOpportunity,
  referrer: PublicKey | null = null
): Promise<ClaimBatch> {
  if (!FEE_WALLET && FEE_PERCENT > 0) {
    throw new Error(
      "Fee wallet is not configured. Refusing to build claim transactions."
    );
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    feePayer: user,
    blockhash,
    lastValidBlockHeight,
  });

  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 })
  );

  for (const ix of buildPumpCashbackInstructions(user, {
    cashbackLamports: opportunity.cashbackLamports,
  })) {
    tx.add(ix);
  }

  const fees = await appendFeeTransfer(
    connection,
    tx,
    user,
    opportunity.lamports,
    referrer
  );

  return {
    transaction: tx,
    accounts: [],
    rentLamports: opportunity.lamports,
    feeLamports: fees.totalFee,
    platformFeeLamports: fees.platformFee,
    referrerFeeLamports: fees.referrerFee,
    action: "pump_cashback",
    blockhash,
    lastValidBlockHeight,
  };
}

export async function buildClaimTransactions(
  connection: Connection,
  user: PublicKey,
  selected: EmptyTokenAccount[],
  referrer: PublicKey | null = null
): Promise<ClaimBatch[]> {
  if (!FEE_WALLET && FEE_PERCENT > 0) {
    throw new Error(
      "Fee wallet is not configured. Refusing to build claim transactions."
    );
  }

  const closable = selected.filter((a) => a.closable);
  const batches = chunk(closable, CLOSES_PER_TX);
  const results: ClaimBatch[] = [];

  for (const accounts of batches) {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction({
      feePayer: user,
      blockhash,
      lastValidBlockHeight,
    });

    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: Math.max(50_000, 25_000 * accounts.length + 20_000),
      }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 })
    );

    let rentLamports = 0;
    for (const acc of accounts) {
      const programId = new PublicKey(acc.programId);
      rentLamports += acc.lamports;
      tx.add(
        createCloseAccountInstruction(
          new PublicKey(acc.address),
          user,
          user,
          [],
          programId
        )
      );
    }

    const fees = await appendFeeTransfer(
      connection,
      tx,
      user,
      rentLamports,
      referrer
    );

    results.push({
      transaction: tx,
      accounts,
      rentLamports,
      feeLamports: fees.totalFee,
      platformFeeLamports: fees.platformFee,
      referrerFeeLamports: fees.referrerFee,
      action: "vacant_account",
      blockhash,
      lastValidBlockHeight,
    });
  }

  return results;
}
