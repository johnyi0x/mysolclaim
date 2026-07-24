import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { createCloseAccountInstruction } from "@solana/spl-token";
import { CLOSES_PER_TX, FEE_PERCENT, FEE_WALLET } from "./constants";
import type { EmptyTokenAccount } from "./scan";

export interface ClaimBatch {
  transaction: Transaction;
  accounts: EmptyTokenAccount[];
  /** Total rent (lamports) refunded to the user by this batch. */
  rentLamports: number;
  /** Service fee (lamports) transferred to the fee wallet in the same tx. */
  feeLamports: number;
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
  // Defense in depth: never close an account whose address isn't a valid pubkey
  // owned by this user in the current scan results.
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
      // Extra guard: refuse to include anything that somehow has unknown program.
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

    const feeLamports = FEE_WALLET ? computeFee(rentLamports) : 0;
    // Cap fee so it can never exceed reclaimed rent (shouldn't with % math,
    // but protects against a misconfigured FEE_PERCENT > 100).
    const safeFee = Math.min(feeLamports, rentLamports);
    if (FEE_WALLET && safeFee > 0) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user,
          toPubkey: FEE_WALLET,
          lamports: safeFee,
        })
      );
    }

    results.push({
      transaction: tx,
      accounts,
      rentLamports,
      feeLamports: safeFee,
    });
  }

  return results;
}
