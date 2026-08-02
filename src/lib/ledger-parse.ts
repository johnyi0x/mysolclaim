import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { PUMP_PROGRAM_ID } from "./pump-cashback";

export type ClaimActionType =
  | "vacant_account"
  | "pump_cashback"
  | "burn_token"
  | "mixed";

export interface ParsedClaim {
  signature: string;
  blockTime: number;
  wallet: string;
  accountsClosed: number;
  reclaimedLamports: number;
  action: ClaimActionType;
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

export function classifyClaimAction(tx: ParsedTransactionWithMeta): {
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
 * Extract a MySolClaim-style reclaim row from a fee-wallet-related tx.
 * Uses fee-payer balance delta (reclaimed net of fee tip) — same as prior ledger.
 */
export function parseClaimFromTx(
  signature: string,
  tx: ParsedTransactionWithMeta | null,
  fallbackBlockTime = 0
): ParsedClaim | null {
  if (!tx || tx.meta?.err) return null;

  const { action, accountsClosed } = classifyClaimAction(tx);
  if (!action) return null;

  const keys = tx.transaction.message.accountKeys;
  const feePayerIndex = keys.findIndex((k) => k.signer);
  if (feePayerIndex === -1) return null;

  const pre = tx.meta?.preBalances?.[feePayerIndex] ?? 0;
  const post = tx.meta?.postBalances?.[feePayerIndex] ?? 0;
  const reclaimedLamports = post - pre;
  if (reclaimedLamports <= 0) return null;

  return {
    signature,
    blockTime: tx.blockTime ?? fallbackBlockTime,
    wallet: keys[feePayerIndex].pubkey.toBase58(),
    accountsClosed,
    reclaimedLamports,
    action,
  };
}
