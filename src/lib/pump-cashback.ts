import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

/** Pump.fun bonding-curve program (cashback + volume accumulator). */
export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

const USER_VOLUME_SEED = Buffer.from("user_volume_accumulator");
const EVENT_AUTHORITY_SEED = Buffer.from("__event_authority");

/**
 * Legacy `claim_cashback` — SOL only, no ATA creation.
 * Prefer this over claim_cashback_v2: v2 can init WSOL ATAs and fail with
 * InsufficientFundsForRent when the wallet has almost no liquid SOL.
 */
export const CLAIM_CASHBACK_DISC = Buffer.from([
  37, 58, 35, 126, 190, 53, 228, 197,
]);
export const CLAIM_CASHBACK_V2_DISC = Buffer.from([
  122, 243, 204, 65, 94, 116, 29, 55,
]);
export const CLOSE_USER_VOLUME_DISC = Buffer.from([
  249, 69, 164, 218, 150, 103, 84, 138,
]);

/** Ignore dust above rent — avoids unnecessary claim ixs. */
const CASHBACK_DUST_LAMPORTS = 50_000; // 0.00005 SOL

export interface PumpCashbackOpportunity {
  /** UserVolumeAccumulator PDA address. */
  accumulator: string;
  /** Total lamports on the PDA (all reclaimable via claim+close). */
  lamports: number;
  /** Lamports above rent-exempt minimum (unclaimed SOL cashback). */
  cashbackLamports: number;
  /** Rent returned when the accumulator is closed. */
  rentLamports: number;
}

export function getUserVolumeAccumulatorPda(user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [USER_VOLUME_SEED, user.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}

export function getPumpEventAuthority(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [EVENT_AUTHORITY_SEED],
    PUMP_PROGRAM_ID
  );
  return pda;
}

/**
 * Detect reclaimable Pump.fun trader cashback + volume-PDA rent for a wallet.
 *
 * 1) optional `claim_cashback` (legacy) — excess lamports → user (no ATAs)
 * 2) `close_user_volume_accumulator` — rent → user
 */
export async function findPumpCashback(
  connection: Connection,
  user: PublicKey
): Promise<PumpCashbackOpportunity | null> {
  const accumulator = getUserVolumeAccumulatorPda(user);
  const info = await connection.getAccountInfo(accumulator, "confirmed");
  if (!info || !info.owner.equals(PUMP_PROGRAM_ID) || info.lamports <= 0) {
    return null;
  }

  const rentLamports = await connection.getMinimumBalanceForRentExemption(
    info.data.length
  );
  const cashbackLamports = Math.max(0, info.lamports - rentLamports);

  return {
    accumulator: accumulator.toBase58(),
    lamports: info.lamports,
    cashbackLamports,
    rentLamports: Math.min(rentLamports, info.lamports),
  };
}

/** Legacy claim_cashback — accounts from pump IDL (includes system_program). */
function buildClaimCashbackLegacyIx(user: PublicKey): TransactionInstruction {
  const accumulator = getUserVolumeAccumulatorPda(user);
  const eventAuthority = getPumpEventAuthority();

  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: false, isWritable: true },
      { pubkey: accumulator, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: CLAIM_CASHBACK_DISC,
  });
}

function buildCloseUserVolumeIx(user: PublicKey): TransactionInstruction {
  const accumulator = getUserVolumeAccumulatorPda(user);
  const eventAuthority = getPumpEventAuthority();

  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: accumulator, isSigner: false, isWritable: true },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: CLOSE_USER_VOLUME_DISC,
  });
}

/**
 * Build reclaim instructions.
 * - Never uses claim_cashback_v2 (can create WSOL ATAs → InsufficientFundsForRent).
 * - Claims excess SOL via legacy claim_cashback only when meaningful.
 * - Always closes the volume accumulator to return rent.
 */
export function buildPumpCashbackInstructions(
  user: PublicKey,
  options?: { cashbackLamports?: number }
): TransactionInstruction[] {
  const cashback = options?.cashbackLamports ?? 0;
  const ixs: TransactionInstruction[] = [];
  if (cashback >= CASHBACK_DUST_LAMPORTS) {
    ixs.push(buildClaimCashbackLegacyIx(user));
  }
  ixs.push(buildCloseUserVolumeIx(user));
  return ixs;
}

/** True if instruction data starts with a known Pump cashback/close discriminator. */
export function isPumpCashbackInstructionData(
  data: Buffer | Uint8Array
): boolean {
  if (data.length < 8) return false;
  const head = Buffer.from(data.slice(0, 8));
  return (
    head.equals(CLAIM_CASHBACK_V2_DISC) ||
    head.equals(CLOSE_USER_VOLUME_DISC) ||
    head.equals(CLAIM_CASHBACK_DISC)
  );
}
