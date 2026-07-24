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

/**
 * Append service-fee transfer.
 *
 * Critical: if the fee wallet account does not exist yet (or is below
 * rent-exempt), SystemProgram.transfer *creates/funds* it. The transfer
 * amount MUST be >= rent-exempt minimum or Solana returns
 * InsufficientFundsForRent on the fee-wallet account index — which is the
 * failure users were seeing on both Pump and vacant claims.
 */
async function appendFeeTransfer(
  connection: Connection,
  tx: Transaction,
  user: PublicKey,
  reclaimableLamports: number
): Promise<number> {
  if (!FEE_WALLET || FEE_PERCENT <= 0 || reclaimableLamports <= 0) {
    return 0;
  }

  let feeLamports = computeFee(reclaimableLamports);

  const rent0 = await connection.getMinimumBalanceForRentExemption(0);
  const feeInfo = await connection.getAccountInfo(FEE_WALLET, "confirmed");

  if (!feeInfo) {
    // First ever tip creates the fee wallet — must meet rent-exempt floor.
    feeLamports = Math.max(feeLamports, rent0);
  } else if (
    feeInfo.data.length === 0 &&
    feeInfo.lamports > 0 &&
    feeInfo.lamports < rent0
  ) {
    // Under-rented system account — top up to rent-exempt.
    feeLamports = Math.max(feeLamports, rent0 - feeInfo.lamports);
  }

  // Never take more than this batch reclaims (user must still net something
  // when reclaimable > rent0; if reclaimable < rent0 and wallet missing, skip).
  const safeFee = Math.min(feeLamports, reclaimableLamports);

  if (!feeInfo && safeFee < rent0) {
    throw new Error(
      `Fee wallet is not initialized on-chain and this claim (${safeFee} lamports fee) is too small to create it (needs ≥ ${rent0}). Send ~0.001 SOL to your fee wallet once, then retry.`
    );
  }

  if (safeFee > 0) {
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
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 })
  );

  for (const ix of buildPumpCashbackInstructions(user, {
    cashbackLamports: opportunity.cashbackLamports,
  })) {
    tx.add(ix);
  }

  const feeLamports = await appendFeeTransfer(
    connection,
    tx,
    user,
    opportunity.lamports
  );

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
 * - Only accounts already filtered as amount===0 + closable are included.
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

    // Token-2022 closes with extensions need more CU than classic SPL.
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
          user, // rent → user
          user, // authority → user
          [],
          programId
        )
      );
    }

    const feeLamports = await appendFeeTransfer(
      connection,
      tx,
      user,
      rentLamports
    );

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
