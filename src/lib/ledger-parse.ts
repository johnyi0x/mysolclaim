import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  PUMP_AMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  isPumpCashbackInstructionData,
} from "./pump-cashback";
import { WITHDRAW_EXCESS_LAMPORTS_IX } from "./scan";

export type ClaimActionType =
  | "vacant_account"
  | "excess_rent"
  | "pump_cashback"
  | "pump_usdc"
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

function programIdOf(ix: {
  programId?: unknown;
  program?: unknown;
}): string | null {
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

function isTokenProgramId(pid: string | null): boolean {
  if (!pid) return false;
  return (
    pid === TOKEN_PROGRAM_ID.toBase58() ||
    pid === TOKEN_2022_PROGRAM_ID.toBase58()
  );
}

function isPumpProgramId(pid: string | null): boolean {
  if (!pid) return false;
  return (
    pid === PUMP_PROGRAM_ID.toBase58() ||
    pid === PUMP_AMM_PROGRAM_ID.toBase58()
  );
}

function firstDataByte(data: unknown): number | null {
  if (data instanceof Uint8Array && data.length > 0) return data[0]!;
  if (Array.isArray(data) && data.length > 0) return Number(data[0]);
  if (typeof data === "string" && data.length > 0) {
    try {
      if (typeof Buffer !== "undefined") {
        const buf = Buffer.from(data, "base64");
        if (buf.length > 0) return buf[0]!;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function dataAsBuffer(data: unknown): Buffer | null {
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.from(data);
  if (typeof data === "string" && data.length > 0) {
    try {
      return Buffer.from(data, "base64");
    } catch {
      return null;
    }
  }
  return null;
}

function isWithdrawExcessIx(ix: {
  programId?: unknown;
  program?: unknown;
  parsed?: { type?: string };
  data?: unknown;
}): boolean {
  const parsedType = (ix.parsed?.type ?? "").toLowerCase().replace(/_/g, "");
  if (parsedType === "withdrawexcesslamports") return true;
  if (!isTokenProgramId(programIdOf(ix))) return false;
  return firstDataByte(ix.data) === WITHDRAW_EXCESS_LAMPORTS_IX;
}

function isPumpIx(ix: {
  programId?: unknown;
  program?: unknown;
  data?: unknown;
}): boolean {
  const pid = programIdOf(ix);
  if (!isPumpProgramId(pid)) return false;
  const buf = dataAsBuffer(ix.data);
  if (buf && isPumpCashbackInstructionData(buf)) return true;
  return Boolean(pid);
}

export function classifyClaimAction(tx: ParsedTransactionWithMeta): {
  action: ClaimActionType | null;
  accountsClosed: number;
} {
  let accountsClosed = 0;
  let excessWithdraws = 0;
  let hasPump = false;

  const considerIx = (ix: {
    programId?: unknown;
    program?: unknown;
    parsed?: { type?: string };
    data?: unknown;
  }) => {
    if (ix.parsed?.type === "closeAccount") accountsClosed++;
    if (isWithdrawExcessIx(ix)) excessWithdraws++;
    if (isPumpIx(ix)) hasPump = true;
  };

  for (const ix of tx.transaction.message.instructions) {
    considerIx(ix as {
      programId?: unknown;
      parsed?: { type?: string };
      data?: unknown;
    });
  }
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      considerIx(ix as {
        programId?: unknown;
        parsed?: { type?: string };
        data?: unknown;
      });
    }
  }

  const kinds =
    (accountsClosed > 0 ? 1 : 0) +
    (excessWithdraws > 0 ? 1 : 0) +
    (hasPump ? 1 : 0);

  if (kinds > 1) return { action: "mixed", accountsClosed };
  if (hasPump) return { action: "pump_cashback", accountsClosed: 0 };
  if (accountsClosed > 0) return { action: "vacant_account", accountsClosed };
  if (excessWithdraws > 0) return { action: "excess_rent", accountsClosed: 0 };
  return { action: null, accountsClosed: 0 };
}

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

  // Pump USDC claims may not increase SOL; still record if classified.
  if (reclaimedLamports <= 0 && !action.startsWith("pump")) return null;

  return {
    signature,
    blockTime: tx.blockTime ?? fallbackBlockTime,
    wallet: keys[feePayerIndex].pubkey.toBase58(),
    accountsClosed,
    reclaimedLamports: Math.max(0, reclaimedLamports),
    action,
  };
}
