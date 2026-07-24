import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

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

interface ParsedTokenAccountInfo {
  mint: string;
  tokenAmount?: { amount?: string };
  closeAuthority?: string;
  state?: string;
  extensions?: { extension: string; state?: { withheldAmount?: string | number } }[];
}

function inspectAccount(
  owner: PublicKey,
  pubkey: PublicKey,
  lamports: number,
  info: ParsedTokenAccountInfo,
  programId: PublicKey
): EmptyTokenAccount | null {
  // Only zero-balance accounts. The Token Program enforces this on-chain
  // too, but we never even present a non-empty account for selection.
  if (info.tokenAmount?.amount !== "0") return null;

  let closable = true;
  let reason: string | undefined;

  // A foreign close authority means our user cannot close this account.
  if (info.closeAuthority && info.closeAuthority !== owner.toBase58()) {
    closable = false;
    reason = "Close authority is held by another account";
  }

  // Token-2022 accounts with withheld transfer fees cannot be closed until
  // fees are harvested to the mint (program error 0x23).
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

/**
 * Read-only scan for zero-balance token accounts owned by `owner`,
 * across both the classic Token Program and Token-2022.
 */
export async function findEmptyTokenAccounts(
  connection: Connection,
  owner: PublicKey
): Promise<EmptyTokenAccount[]> {
  const [classic, token2022] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    }),
    connection
      .getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID })
      .catch(() => ({ value: [] })),
  ]);

  const results: EmptyTokenAccount[] = [];

  const scanned: [typeof classic.value, PublicKey][] = [
    [classic.value, TOKEN_PROGRAM_ID],
    [token2022.value, TOKEN_2022_PROGRAM_ID],
  ];

  for (const [accounts, programId] of scanned) {
    for (const { pubkey, account } of accounts) {
      const parsed = account.data.parsed?.info as
        | ParsedTokenAccountInfo
        | undefined;
      if (!parsed) continue;
      const item = inspectAccount(
        owner,
        pubkey,
        account.lamports,
        parsed,
        programId
      );
      if (item) results.push(item);
    }
  }

  // Closable first, largest rent first.
  return results.sort((a, b) => {
    if (a.closable !== b.closable) return a.closable ? -1 : 1;
    return b.lamports - a.lamports;
  });
}
