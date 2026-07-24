import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

/** Pump.fun bonding-curve program (cashback + volume accumulator). */
export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

const USER_VOLUME_SEED = Buffer.from("user_volume_accumulator");
const EVENT_AUTHORITY_SEED = Buffer.from("__event_authority");

/** Anchor discriminators from pump IDL. */
export const CLAIM_CASHBACK_V2_DISC = Buffer.from([
  122, 243, 204, 65, 94, 116, 29, 55,
]);
export const CLOSE_USER_VOLUME_DISC = Buffer.from([
  249, 69, 164, 218, 150, 103, 84, 138,
]);

export interface PumpCashbackOpportunity {
  /** UserVolumeAccumulator PDA address. */
  accumulator: string;
  /** Total lamports on the PDA (cashback above rent + rent, all reclaimable via claim+close). */
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
 * Mechanics (official pump-public-docs + claimfreesol-style reclaim):
 * 1) `claim_cashback_v2` moves lamports above rent from the accumulator → user
 * 2) `close_user_volume_accumulator` returns the rent-exempt deposit → user
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

function buildClaimCashbackV2Ix(user: PublicKey): TransactionInstruction {
  const accumulator = getUserVolumeAccumulatorPda(user);
  const eventAuthority = getPumpEventAuthority();
  const associatedAccumulator = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    accumulator,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const associatedUser = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    user,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: false, isWritable: true },
      { pubkey: accumulator, isSigner: false, isWritable: true },
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: associatedAccumulator, isSigner: false, isWritable: true },
      { pubkey: associatedUser, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: CLAIM_CASHBACK_V2_DISC,
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

/** claim_cashback_v2 then close_user_volume_accumulator (matches claimfreesol / CLosey flow). */
export function buildPumpCashbackInstructions(
  user: PublicKey
): TransactionInstruction[] {
  return [buildClaimCashbackV2Ix(user), buildCloseUserVolumeIx(user)];
}

/** True if instruction data starts with a known Pump cashback/close discriminator. */
export function isPumpCashbackInstructionData(data: Buffer | Uint8Array): boolean {
  if (data.length < 8) return false;
  const head = Buffer.from(data.slice(0, 8));
  return (
    head.equals(CLAIM_CASHBACK_V2_DISC) ||
    head.equals(CLOSE_USER_VOLUME_DISC) ||
    // legacy claim_cashback
    head.equals(Buffer.from([37, 58, 35, 126, 190, 53, 228, 197]))
  );
}
