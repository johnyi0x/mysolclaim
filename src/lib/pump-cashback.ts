import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

/** Pump.fun bonding-curve program. */
export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

/** PumpSwap / Pump AMM program. */
export const PUMP_AMM_PROGRAM_ID = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
);

export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

const USER_VOLUME_SEED = Buffer.from("user_volume_accumulator");
const EVENT_AUTHORITY_SEED = Buffer.from("__event_authority");

/** Shared claim_cashback discriminator (Pump + Pump AMM). */
export const CLAIM_CASHBACK_DISC = Buffer.from([
  37, 58, 35, 126, 190, 53, 228, 197,
]);
/** Bonding-curve claim_cashback_v2 (SOL or token quote). */
export const CLAIM_CASHBACK_V2_DISC = Buffer.from([
  122, 243, 204, 65, 94, 116, 29, 55,
]);
export const CLOSE_USER_VOLUME_DISC = Buffer.from([
  249, 69, 164, 218, 150, 103, 84, 138,
]);

const SOL_DUST = 50_000; // 0.00005 SOL
const USDC_DUST = 1_000; // 0.001 USDC (6 decimals)

export interface PumpBondingSolOpportunity {
  kind: "bonding_sol";
  accumulator: string;
  /** Total lamports on PDA (cashback + rent). */
  lamports: number;
  cashbackLamports: number;
  rentLamports: number;
}

export interface PumpTokenCashbackOpportunity {
  kind: "amm_wsol" | "amm_usdc" | "bonding_usdc";
  programId: string;
  mint: string;
  symbol: "SOL" | "USDC";
  decimals: number;
  /** Raw token amount. For WSOL, 1 raw = 1 lamport. */
  amount: number;
  accumulator: string;
  sourceAta: string;
}

export interface PumpReclaimScan {
  bondingSol: PumpBondingSolOpportunity | null;
  ammWsol: PumpTokenCashbackOpportunity | null;
  ammUsdc: PumpTokenCashbackOpportunity | null;
  bondingUsdc: PumpTokenCashbackOpportunity | null;
}

export function getUserVolumeAccumulatorPda(
  user: PublicKey,
  programId: PublicKey = PUMP_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [USER_VOLUME_SEED, user.toBuffer()],
    programId
  );
  return pda;
}

export function getPumpEventAuthority(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [EVENT_AUTHORITY_SEED],
    programId
  );
  return pda;
}

function tokenAmountFromAccountData(data: Buffer): number {
  // SPL token account: amount is u64 LE at offset 64
  if (data.length < 72) return 0;
  const amount = data.readBigUInt64LE(64);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(amount);
}

/**
 * One getMultipleAccountsInfo for bonding + AMM cashback sources (RPC-efficient).
 */
export async function findPumpReclaim(
  connection: Connection,
  user: PublicKey
): Promise<PumpReclaimScan> {
  const bondingPda = getUserVolumeAccumulatorPda(user, PUMP_PROGRAM_ID);
  const ammPda = getUserVolumeAccumulatorPda(user, PUMP_AMM_PROGRAM_ID);

  const bondingWsolAta = getAssociatedTokenAddressSync(
    WSOL_MINT,
    bondingPda,
    true
  );
  const bondingUsdcAta = getAssociatedTokenAddressSync(
    USDC_MINT,
    bondingPda,
    true
  );
  const ammWsolAta = getAssociatedTokenAddressSync(WSOL_MINT, ammPda, true);
  const ammUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, ammPda, true);

  const infos = await connection.getMultipleAccountsInfo(
    [
      bondingPda,
      ammPda,
      bondingWsolAta,
      bondingUsdcAta,
      ammWsolAta,
      ammUsdcAta,
    ],
    "confirmed"
  );

  const [
    bondingInfo,
    ammInfo,
    bondingWsolInfo,
    bondingUsdcInfo,
    ammWsolInfo,
    ammUsdcInfo,
  ] = infos;

  let bondingSol: PumpBondingSolOpportunity | null = null;
  if (
    bondingInfo &&
    bondingInfo.owner.equals(PUMP_PROGRAM_ID) &&
    bondingInfo.lamports > 0
  ) {
    let rentLamports = 890_880;
    try {
      rentLamports = await connection.getMinimumBalanceForRentExemption(
        bondingInfo.data.length
      );
    } catch {
      // fallback
    }
    const cashbackLamports = Math.max(0, bondingInfo.lamports - rentLamports);
    bondingSol = {
      kind: "bonding_sol",
      accumulator: bondingPda.toBase58(),
      lamports: bondingInfo.lamports,
      cashbackLamports,
      rentLamports: Math.min(rentLamports, bondingInfo.lamports),
    };
  }

  const mkToken = (
    kind: PumpTokenCashbackOpportunity["kind"],
    programId: PublicKey,
    mint: PublicKey,
    symbol: "SOL" | "USDC",
    decimals: number,
    ata: PublicKey,
    info: (typeof infos)[0],
    accumulator: PublicKey
  ): PumpTokenCashbackOpportunity | null => {
    if (!info || info.lamports <= 0) return null;
    const amount = tokenAmountFromAccountData(Buffer.from(info.data));
    const dust = symbol === "USDC" ? USDC_DUST : SOL_DUST;
    if (amount < dust) return null;
    return {
      kind,
      programId: programId.toBase58(),
      mint: mint.toBase58(),
      symbol,
      decimals,
      amount,
      accumulator: accumulator.toBase58(),
      sourceAta: ata.toBase58(),
    };
  };

  // AMM cashback only meaningful if AMM accumulator exists (or ATA exists).
  const ammWsol =
    ammInfo || ammWsolInfo
      ? mkToken(
          "amm_wsol",
          PUMP_AMM_PROGRAM_ID,
          WSOL_MINT,
          "SOL",
          9,
          ammWsolAta,
          ammWsolInfo,
          ammPda
        )
      : null;
  const ammUsdc =
    ammInfo || ammUsdcInfo
      ? mkToken(
          "amm_usdc",
          PUMP_AMM_PROGRAM_ID,
          USDC_MINT,
          "USDC",
          6,
          ammUsdcAta,
          ammUsdcInfo,
          ammPda
        )
      : null;
  const bondingUsdc = bondingInfo
    ? mkToken(
        "bonding_usdc",
        PUMP_PROGRAM_ID,
        USDC_MINT,
        "USDC",
        6,
        bondingUsdcAta,
        bondingUsdcInfo,
        bondingPda
      )
    : null;

  return { bondingSol, ammWsol, ammUsdc, bondingUsdc };
}

/** @deprecated Prefer findPumpReclaim — kept for older call sites. */
export async function findPumpCashback(
  connection: Connection,
  user: PublicKey
): Promise<PumpBondingSolOpportunity | null> {
  const scan = await findPumpReclaim(connection, user);
  return scan.bondingSol;
}

function buildBondingClaimLegacyIx(user: PublicKey): TransactionInstruction {
  const accumulator = getUserVolumeAccumulatorPda(user, PUMP_PROGRAM_ID);
  const eventAuthority = getPumpEventAuthority(PUMP_PROGRAM_ID);
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

function buildCloseBondingVolumeIx(user: PublicKey): TransactionInstruction {
  const accumulator = getUserVolumeAccumulatorPda(user, PUMP_PROGRAM_ID);
  const eventAuthority = getPumpEventAuthority(PUMP_PROGRAM_ID);
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

/** Bonding claim_cashback_v2 for token quotes (e.g. USDC). */
function buildBondingClaimV2Ix(
  user: PublicKey,
  quoteMint: PublicKey,
  accumulatorAta: PublicKey,
  userAta: PublicKey
): TransactionInstruction {
  const accumulator = getUserVolumeAccumulatorPda(user, PUMP_PROGRAM_ID);
  const eventAuthority = getPumpEventAuthority(PUMP_PROGRAM_ID);
  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: false, isWritable: true },
      { pubkey: accumulator, isSigner: false, isWritable: true },
      { pubkey: quoteMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      {
        pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: accumulatorAta, isSigner: false, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: CLAIM_CASHBACK_V2_DISC,
  });
}

/** Pump AMM claim_cashback for WSOL or USDC quote. */
function buildAmmClaimCashbackIx(
  user: PublicKey,
  quoteMint: PublicKey,
  accumulatorAta: PublicKey,
  userAta: PublicKey
): TransactionInstruction {
  const accumulator = getUserVolumeAccumulatorPda(user, PUMP_AMM_PROGRAM_ID);
  const eventAuthority = getPumpEventAuthority(PUMP_AMM_PROGRAM_ID);
  return new TransactionInstruction({
    programId: PUMP_AMM_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: false, isWritable: true },
      { pubkey: accumulator, isSigner: false, isWritable: true },
      { pubkey: quoteMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: accumulatorAta, isSigner: false, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_AMM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: CLAIM_CASHBACK_DISC,
  });
}

export function buildBondingSolInstructions(
  user: PublicKey,
  opportunity: PumpBondingSolOpportunity
): TransactionInstruction[] {
  const ixs: TransactionInstruction[] = [];
  if (opportunity.cashbackLamports >= SOL_DUST) {
    ixs.push(buildBondingClaimLegacyIx(user));
  }
  ixs.push(buildCloseBondingVolumeIx(user));
  return ixs;
}

/**
 * Claim PumpSwap WSOL → user WSOL ATA → close ATA to unwrap native SOL.
 * User pays ATA rent briefly; close refunds it with the cashback.
 */
export function buildAmmWsolInstructions(
  user: PublicKey,
  opportunity: PumpTokenCashbackOpportunity
): TransactionInstruction[] {
  const userWsol = getAssociatedTokenAddressSync(WSOL_MINT, user, false);
  const sourceAta = new PublicKey(opportunity.sourceAta);
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      userWsol,
      user,
      WSOL_MINT
    ),
    buildAmmClaimCashbackIx(user, WSOL_MINT, sourceAta, userWsol),
    createCloseAccountInstruction(userWsol, user, user),
  ];
}

/**
 * Claim USDC cashback (AMM or bonding v2) to user ATA.
 * Optional fee/referral USDC transfers appended by claim builder.
 */
export function buildUsdcCashbackInstructions(
  user: PublicKey,
  opportunity: PumpTokenCashbackOpportunity
): TransactionInstruction[] {
  const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, user, false);
  const sourceAta = new PublicKey(opportunity.sourceAta);
  const ixs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      userUsdc,
      user,
      USDC_MINT
    ),
  ];
  if (opportunity.kind === "bonding_usdc") {
    ixs.push(buildBondingClaimV2Ix(user, USDC_MINT, sourceAta, userUsdc));
  } else {
    ixs.push(buildAmmClaimCashbackIx(user, USDC_MINT, sourceAta, userUsdc));
  }
  return ixs;
}

export function buildUsdcFeeTransfers(
  user: PublicKey,
  totalUsdcRaw: number,
  feeWallet: PublicKey,
  platformFeeRaw: number,
  referrer: PublicKey | null,
  referrerFeeRaw: number
): TransactionInstruction[] {
  const ixs: TransactionInstruction[] = [];
  if (platformFeeRaw <= 0 && referrerFeeRaw <= 0) return ixs;
  if (platformFeeRaw + referrerFeeRaw > totalUsdcRaw) return ixs;

  const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, user, false);

  if (platformFeeRaw > 0) {
    const feeAta = getAssociatedTokenAddressSync(USDC_MINT, feeWallet, false);
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        user,
        feeAta,
        feeWallet,
        USDC_MINT
      ),
      createTransferInstruction(userUsdc, feeAta, user, platformFeeRaw)
    );
  }

  if (referrer && referrerFeeRaw > 0) {
    const refAta = getAssociatedTokenAddressSync(USDC_MINT, referrer, false);
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        user,
        refAta,
        referrer,
        USDC_MINT
      ),
      createTransferInstruction(userUsdc, refAta, user, referrerFeeRaw)
    );
  }

  return ixs;
}

/** True if instruction targets Pump or Pump AMM cashback/close. */
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

export function pumpSolReclaimable(scan: PumpReclaimScan): number {
  let n = 0;
  if (scan.bondingSol) n += scan.bondingSol.lamports;
  if (scan.ammWsol) n += scan.ammWsol.amount;
  return n;
}

export function pumpUsdcReclaimable(scan: PumpReclaimScan): number {
  let n = 0;
  if (scan.ammUsdc) n += scan.ammUsdc.amount;
  if (scan.bondingUsdc) n += scan.bondingUsdc.amount;
  return n;
}
