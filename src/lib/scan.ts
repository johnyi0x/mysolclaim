import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

/** P-token / Token-2022 WithdrawExcessLamports discriminator. */
export const WITHDRAW_EXCESS_LAMPORTS_IX = 38;

/** Ignore dust smaller than this (lamports). */
export const MIN_EXCESS_LAMPORTS = 1_000;

export interface EmptyTokenAccount {
  /** Token account address (the account that will be closed). */
  address: string;
  /** Mint of the token this account was created for. */
  mint: string;
  /** Lamports locked in the account (the rent deposit refunded on close). */
  lamports: number;
  /** Which token program owns the account. */
  programId: string;
  isToken2022: boolean;
  /** False when the account cannot be closed by the connected wallet. */
  closable: boolean;
  /** Human-readable reason when not closable. */
  reason?: string;
}

/** Non-empty (or unclosable) ATA with SOL above the current rent floor. */
export interface ExcessRentAccount {
  address: string;
  mint: string;
  lamports: number;
  excessLamports: number;
  rentExemptLamports: number;
  programId: string;
  isToken2022: boolean;
  /** Raw token amount string (non-zero for typical excess reclaim). */
  tokenAmount: string;
}

export interface TokenReclaimScan {
  accounts: EmptyTokenAccount[];
  excess: ExcessRentAccount[];
}

interface ParsedTokenAccountInfo {
  mint: string;
  tokenAmount?: { amount?: string };
  closeAuthority?: string;
  state?: string;
  isNative?: boolean | string | null;
  extensions?: {
    extension: string;
    state?: { withheldAmount?: string | number };
  }[];
}

function createWithdrawExcessLamportsInstruction(
  source: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  programId: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([WITHDRAW_EXCESS_LAMPORTS_IX]),
  });
}

export { createWithdrawExcessLamportsInstruction };

function inspectVacant(
  owner: PublicKey,
  pubkey: PublicKey,
  lamports: number,
  info: ParsedTokenAccountInfo,
  programId: PublicKey
): EmptyTokenAccount | null {
  if (info.tokenAmount?.amount !== "0") return null;

  let closable = true;
  let reason: string | undefined;

  if (info.closeAuthority && info.closeAuthority !== owner.toBase58()) {
    closable = false;
    reason = "Close authority is held by another account";
  }

  const withheld = info.extensions?.find(
    (e) => e.extension === "transferFeeAmount"
  );
  if (withheld && Number(withheld.state?.withheldAmount ?? 0) > 0) {
    closable = false;
    reason = "Has withheld Token-2022 transfer fees";
  }

  return {
    address: pubkey.toBase58(),
    mint: info.mint,
    lamports,
    programId: programId.toBase58(),
    isToken2022: programId.equals(TOKEN_2022_PROGRAM_ID),
    closable,
    reason,
  };
}

function isNativeTokenAccount(info: ParsedTokenAccountInfo): boolean {
  const n = info.isNative;
  return n === true || n === "true" || (typeof n === "string" && n.length > 0 && n !== "false");
}

/**
 * Fetch current rent-exempt floors for unique account data lengths.
 * Usually 1–3 RPC calls total (classic ATAs share space 165).
 */
async function rentFloorsBySpace(
  connection: Connection,
  spaces: number[]
): Promise<Map<number, number>> {
  const unique = [...new Set(spaces.filter((s) => s > 0))];
  const map = new Map<number, number>();
  if (unique.length === 0) return map;

  await Promise.all(
    unique.map(async (space) => {
      try {
        const min = await connection.getMinimumBalanceForRentExemption(space);
        map.set(space, min);
      } catch {
        // Fallback approx using Step-2 lamports_per_byte (5,080).
        map.set(space, (128 + space) * 5_080);
      }
    })
  );
  return map;
}

/**
 * Single scan: empty closable ATAs (close) + ATAs with excess rent (withdraw).
 * Empty closable accounts are closed fully (better than withdraw-excess).
 * Excess is only listed when close isn't the right path (has balance / unclosable).
 */
export async function findTokenReclaimOpportunities(
  connection: Connection,
  owner: PublicKey
): Promise<TokenReclaimScan> {
  type ParsedTokAccounts = Awaited<
    ReturnType<Connection["getParsedTokenAccountsByOwner"]>
  >["value"];

  const [classic, token2022] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    }),
    connection
      .getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID })
      .catch(() => ({ value: [] as ParsedTokAccounts })),
  ]);

  const scanned: [ParsedTokAccounts, PublicKey][] = [
    [classic.value, TOKEN_PROGRAM_ID],
    [token2022.value, TOKEN_2022_PROGRAM_ID],
  ];

  const spaces: number[] = [];
  for (const [accounts] of scanned) {
    for (const { account } of accounts) {
      const space =
        typeof account.data === "object" &&
        account.data !== null &&
        "space" in account.data
          ? Number((account.data as { space?: number }).space ?? 0)
          : 0;
      if (space > 0) spaces.push(space);
    }
  }

  const floors = await rentFloorsBySpace(connection, spaces);

  const vacant: EmptyTokenAccount[] = [];
  const excess: ExcessRentAccount[] = [];

  for (const [accounts, programId] of scanned) {
    for (const { pubkey, account } of accounts) {
      const parsed = account.data.parsed?.info as
        | ParsedTokenAccountInfo
        | undefined;
      if (!parsed) continue;

      const space =
        typeof account.data === "object" &&
        account.data !== null &&
        "space" in account.data
          ? Number((account.data as { space?: number }).space ?? 0)
          : 0;

      const vacantItem = inspectVacant(
        owner,
        pubkey,
        account.lamports,
        parsed,
        programId
      );
      if (vacantItem) {
        vacant.push(vacantItem);
        // Closable empty → close recovers ALL lamports; skip excess path.
        if (vacantItem.closable) continue;
      }

      // WithdrawExcessLamports does not support wrapped-SOL accounts.
      if (isNativeTokenAccount(parsed)) continue;

      const rentExempt = floors.get(space) ?? 0;
      if (rentExempt <= 0) continue;
      const excessLamports = account.lamports - rentExempt;
      if (excessLamports < MIN_EXCESS_LAMPORTS) continue;

      excess.push({
        address: pubkey.toBase58(),
        mint: parsed.mint,
        lamports: account.lamports,
        excessLamports,
        rentExemptLamports: rentExempt,
        programId: programId.toBase58(),
        isToken2022: programId.equals(TOKEN_2022_PROGRAM_ID),
        tokenAmount: parsed.tokenAmount?.amount ?? "0",
      });
    }
  }

  vacant.sort((a, b) => {
    if (a.closable !== b.closable) return a.closable ? -1 : 1;
    return b.lamports - a.lamports;
  });
  excess.sort((a, b) => b.excessLamports - a.excessLamports);

  return { accounts: vacant, excess };
}

/** @deprecated Prefer findTokenReclaimOpportunities — kept for call-site clarity. */
export async function findEmptyTokenAccounts(
  connection: Connection,
  owner: PublicKey
): Promise<EmptyTokenAccount[]> {
  const { accounts } = await findTokenReclaimOpportunities(connection, owner);
  return accounts;
}
