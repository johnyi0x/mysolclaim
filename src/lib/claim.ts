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
import type { EmptyTokenAccount } from "./scan";

export type ClaimActionType = "vacant_account" | "pump_cashback";

export interface ClaimBatch {
  transaction: Transaction;
  accounts: EmptyTokenAccount[];
  /** Total rent / reclaimable (lamports) refunded to the user by this batch. */
  rentLamports: number;
  /** Service fee (lamports) transferred to the fee wallet in the same tx. */
  feeLamports: number;
  action: ClaimActionType;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function computeFee(rentLamports: number): number {
  // Floor so we never over-charge relative to the displayed percentage.
  return Math.floor((rentLamports * FEE_PERCENT) / 100);
}

function appendFeeTransfer(
  tx: Transaction,
  user: PublicKey,
  reclaimableLamports: number
): number {
  const feeLamports = FEE_WALLET ? computeFee(reclaimableLamports) : 0;
  const safeFee = Math.min(feeLamports, reclaimableLamports);
  if (FEE_WALLET && safeFee > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: FEE_WALLET,
        lamports: safeFee,
      })
    );
  }
  return safeFee;
}

/**
 * Build Pump.fun cashback claim + close volume accumulator + service fee.
 * Same pattern as claimfreesol / the CLosey tip txs on Solscan.
 */
export async function buildPumpCashbackTransaction(
  connection: Connection,
  user: PublicKey,
  opportunity: PumpCashbackOpportunity
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
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })
  );

  for (const ix of buildPumpCashbackInstructions(user, {
    // Skip claim when there's nothing above rent — close alone is enough.
    includeClaim: opportunity.cashbackLamports > 0,
  })) {
    tx.add(ix);
  }

  const feeLamports = appendFeeTransfer(tx, user, opportunity.lamports);

  return {
    transaction: tx,
    accounts: [],
    rentLamports: opportunity.lamports,
    feeLamports,
    action: "pump_cashback",
  };
}

/**
 * Build one or more transactions that close the selected empty accounts.
 *
 * Security invariants:
 * - Rent destination is ALWAYS the connected user (never the fee wallet).
 * - Fee is a separate SystemProgram.transfer in the SAME atomic tx.
 * - Only accounts already filtered as amount===0 + closable are included;
 *   the Token Program still rejects non-zero balances on-chain.
 * - Each batch gets a fresh blockhash so slow multi-sig flows don't expire.
 */
export async function buildClaimTransactions(
  connection: Connection,
  user: PublicKey,
  selected: EmptyTokenAccount[]
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
        units: 6_000 * accounts.length + 10_000,
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
          user, // rent → user
          user, // authority → user
          [],
          programId
        )
      );
    }

    const feeLamports = appendFeeTransfer(tx, user, rentLamports);

    results.push({
      transaction: tx,
      accounts,
      rentLamports,
      feeLamports,
      action: "vacant_account",
    });
  }

  return results;
}
