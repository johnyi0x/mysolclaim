/**
 * Durable claim ledger on Neon Postgres.
 *
 * Flow:
 *  1) First run: seed from fee-wallet history → all-time totals in Neon
 *  2) Later: incremental sync of only NEW fee-wallet signatures
 *  3) Reads: O(1) all-time from ledger_totals; 24h from indexed claims rows
 *
 * Security: server-only; parameterized SQL; never log connection string;
 * public API only reads + syncs verified on-chain fee-wallet txs (no client writes).
 */

import {
  PublicKey,
  type Connection,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import {
  LEDGER_DISPLAY_LIMIT,
  LEDGER_HISTORY_CAP,
} from "./constants";
import { getSql, isNeonConfigured } from "./db";
import {
  parseClaimFromTx,
  type ClaimActionType,
  type ParsedClaim,
} from "./ledger-parse";

export type { ClaimActionType, ParsedClaim };

export interface LedgerStats {
  totalClaims: number;
  totalUsers: number;
  totalReclaimedLamports: number;
  totalAccountsClosed: number;
  claims24h: number;
  users24h: number;
  reclaimedLamports24h: number;
}

export interface RecentClaim {
  signature: string;
  blockTime: number;
  wallet: string;
  accountsClosed: number;
  reclaimedLamports: number;
  action: ClaimActionType;
}

export interface LedgerSnapshot {
  configured: boolean;
  durable: boolean;
  claims: RecentClaim[];
  stats: LedgerStats;
}

const EMPTY_STATS: LedgerStats = {
  totalClaims: 0,
  totalUsers: 0,
  totalReclaimedLamports: 0,
  totalAccountsClosed: 0,
  claims24h: 0,
  users24h: 0,
  reclaimedLamports24h: 0,
};

const DAY_SEC = 86_400;
/** Min gap between chain syncs (any warm instance). */
const SYNC_COOLDOWN_MS = 45_000;
/** Safety cap for one-time historical seed pages × page size. */
const SEED_MAX_SIGNATURES = 800;
const SEED_PAGE = 40;

let schemaReady = false;
let lastSyncAttemptMs = 0;
let syncInFlight: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS claims (
      signature TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      block_time BIGINT NOT NULL DEFAULT 0,
      reclaimed_lamports BIGINT NOT NULL DEFAULT 0,
      accounts_closed INT NOT NULL DEFAULT 0,
      action TEXT NOT NULL,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS claims_block_time_idx
    ON claims (block_time DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS claims_wallet_idx ON claims (wallet)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ledger_users (
      wallet TEXT PRIMARY KEY,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ledger_totals (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      total_claims BIGINT NOT NULL DEFAULT 0,
      total_users BIGINT NOT NULL DEFAULT 0,
      total_reclaimed_lamports BIGINT NOT NULL DEFAULT 0,
      total_accounts_closed BIGINT NOT NULL DEFAULT 0
    )
  `;
  await sql`
    INSERT INTO ledger_totals (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ledger_meta (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      seeded BOOLEAN NOT NULL DEFAULT FALSE,
      last_sync_at TIMESTAMPTZ,
      newest_signature TEXT
    )
  `;
  await sql`
    INSERT INTO ledger_meta (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `;

  schemaReady = true;
}

async function getParsedOne(
  connection: Connection,
  signature: string
): Promise<ParsedTransactionWithMeta | null> {
  try {
    return await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
  } catch {
    return null;
  }
}

/**
 * Insert claim if new. Updates running totals + unique users only on insert.
 * Returns true when a new row was written.
 */
async function insertClaimIfNew(claim: ParsedClaim): Promise<boolean> {
  const sql = getSql();

  const inserted = await sql`
    INSERT INTO claims (
      signature, wallet, block_time, reclaimed_lamports, accounts_closed, action
    ) VALUES (
      ${claim.signature},
      ${claim.wallet},
      ${claim.blockTime},
      ${claim.reclaimedLamports},
      ${claim.accountsClosed},
      ${claim.action}
    )
    ON CONFLICT (signature) DO NOTHING
    RETURNING signature
  `;

  if (!Array.isArray(inserted) || inserted.length === 0) return false;

  const userInsert = await sql`
    INSERT INTO ledger_users (wallet)
    VALUES (${claim.wallet})
    ON CONFLICT (wallet) DO NOTHING
    RETURNING wallet
  `;
  const newUser = Array.isArray(userInsert) && userInsert.length > 0 ? 1 : 0;

  await sql`
    UPDATE ledger_totals SET
      total_claims = total_claims + 1,
      total_users = total_users + ${newUser},
      total_reclaimed_lamports = total_reclaimed_lamports + ${claim.reclaimedLamports},
      total_accounts_closed = total_accounts_closed + ${claim.accountsClosed}
    WHERE id = 1
  `;

  return true;
}

async function filterUnknownSignatures(
  signatures: string[]
): Promise<string[]> {
  if (signatures.length === 0) return [];
  const sql = getSql();
  // Find which of these already exist — then keep the unknowns.
  const existing = await sql`
    SELECT signature FROM claims
    WHERE signature = ANY(${signatures})
  `;
  const known = new Set(
    (existing as { signature: string }[]).map((r) => r.signature)
  );
  return signatures.filter((s) => !known.has(s));
}

async function ingestSignatures(
  connection: Connection,
  sigInfos: { signature: string; blockTime: number | null | undefined }[]
): Promise<number> {
  if (sigInfos.length === 0) return 0;

  const unknown = await filterUnknownSignatures(
    sigInfos.map((s) => s.signature)
  );
  if (unknown.length === 0) return 0;

  const unknownSet = new Set(unknown);
  let added = 0;

  for (const info of sigInfos) {
    if (!unknownSet.has(info.signature)) continue;
    const tx = await getParsedOne(connection, info.signature);
    const claim = parseClaimFromTx(
      info.signature,
      tx,
      info.blockTime ?? 0
    );
    if (!claim) continue;
    if (await insertClaimIfNew(claim)) added++;
  }

  return added;
}

async function markSync(newestSignature: string | null, seeded?: boolean) {
  const sql = getSql();
  if (seeded) {
    await sql`
      UPDATE ledger_meta SET
        seeded = TRUE,
        last_sync_at = NOW(),
        newest_signature = COALESCE(${newestSignature}, newest_signature)
      WHERE id = 1
    `;
  } else {
    await sql`
      UPDATE ledger_meta SET
        last_sync_at = NOW(),
        newest_signature = COALESCE(${newestSignature}, newest_signature)
      WHERE id = 1
    `;
  }
}

async function seedFromChain(
  connection: Connection,
  feeWallet: PublicKey
): Promise<void> {
  let before: string | undefined;
  let processed = 0;
  let newest: string | null = null;

  while (processed < SEED_MAX_SIGNATURES) {
    const page = await connection.getSignaturesForAddress(feeWallet, {
      limit: SEED_PAGE,
      ...(before ? { before } : {}),
    });
    if (page.length === 0) break;

    if (!newest) newest = page[0]?.signature ?? null;

    const successful = page.filter((s) => !s.err);
    await ingestSignatures(
      connection,
      successful.map((s) => ({
        signature: s.signature,
        blockTime: s.blockTime,
      }))
    );

    processed += page.length;
    before = page[page.length - 1]?.signature;
    if (page.length < SEED_PAGE) break;
  }

  await markSync(newest, true);
}

async function incrementalSync(
  connection: Connection,
  feeWallet: PublicKey
): Promise<void> {
  const page = await connection.getSignaturesForAddress(feeWallet, {
    limit: LEDGER_HISTORY_CAP,
  });
  const successful = page.filter((s) => !s.err);

  await ingestSignatures(
    connection,
    successful.map((s) => ({
      signature: s.signature,
      blockTime: s.blockTime,
    }))
  );

  await markSync(successful[0]?.signature ?? null);
}

/**
 * Sync fee-wallet history into Neon (seed once, then incremental).
 * Coalesces concurrent calls; skips if recently synced unless `force`.
 */
export async function syncLedgerFromChain(
  connection: Connection,
  feeWalletAddress: string,
  opts?: { force?: boolean }
): Promise<void> {
  if (!isNeonConfigured()) return;

  const force = Boolean(opts?.force);
  const now = Date.now();
  if (
    !force &&
    now - lastSyncAttemptMs < SYNC_COOLDOWN_MS &&
    syncInFlight == null
  ) {
    return;
  }

  if (syncInFlight) {
    await syncInFlight;
    // After waiting, still run a forced incremental if requested and cooldown passed for force
    if (!force) return;
  }

  syncInFlight = (async () => {
    lastSyncAttemptMs = Date.now();
    try {
      await ensureSchema();
      const sql = getSql();
      const metaRows = await sql`
        SELECT seeded, last_sync_at FROM ledger_meta WHERE id = 1
      `;
      const meta = (
        metaRows as { seeded: boolean; last_sync_at: string | null }[]
      )[0];

      // DB-level cooldown (multi-instance) — skip unless force
      if (!force && meta?.last_sync_at) {
        const last = Date.parse(meta.last_sync_at);
        if (
          Number.isFinite(last) &&
          Date.now() - last < SYNC_COOLDOWN_MS &&
          meta.seeded
        ) {
          return;
        }
      }

      const feeWallet = new PublicKey(feeWalletAddress);
      if (!meta?.seeded) {
        await seedFromChain(connection, feeWallet);
      } else {
        await incrementalSync(connection, feeWallet);
      }
    } finally {
      syncInFlight = null;
    }
  })();

  await syncInFlight;
}

export async function readLedgerSnapshot(): Promise<LedgerSnapshot> {
  await ensureSchema();
  const sql = getSql();
  const nowSec = Math.floor(Date.now() / 1000);
  const since = nowSec - DAY_SEC;

  const [totalsRows, dayRows, recentRows] = await Promise.all([
    sql`
      SELECT
        total_claims,
        total_users,
        total_reclaimed_lamports,
        total_accounts_closed
      FROM ledger_totals WHERE id = 1
    `,
    sql`
      SELECT
        COUNT(*)::bigint AS claims24h,
        COUNT(DISTINCT wallet)::bigint AS users24h,
        COALESCE(SUM(reclaimed_lamports), 0)::bigint AS reclaimed24h
      FROM claims
      WHERE block_time >= ${since}
    `,
    sql`
      SELECT
        signature,
        wallet,
        block_time,
        reclaimed_lamports,
        accounts_closed,
        action
      FROM claims
      ORDER BY block_time DESC, signature DESC
      LIMIT ${LEDGER_DISPLAY_LIMIT}
    `,
  ]);

  const totals = (totalsRows as {
    total_claims: string | number;
    total_users: string | number;
    total_reclaimed_lamports: string | number;
    total_accounts_closed: string | number;
  }[])[0];

  const day = (dayRows as {
    claims24h: string | number;
    users24h: string | number;
    reclaimed24h: string | number;
  }[])[0];

  const claims: RecentClaim[] = (
    recentRows as {
      signature: string;
      wallet: string;
      block_time: string | number;
      reclaimed_lamports: string | number;
      accounts_closed: string | number;
      action: string;
    }[]
  ).map((r) => ({
    signature: r.signature,
    wallet: r.wallet,
    blockTime: Number(r.block_time) || 0,
    reclaimedLamports: Number(r.reclaimed_lamports) || 0,
    accountsClosed: Number(r.accounts_closed) || 0,
    action: r.action as ClaimActionType,
  }));

  const stats: LedgerStats = {
    totalClaims: Number(totals?.total_claims ?? 0),
    totalUsers: Number(totals?.total_users ?? 0),
    totalReclaimedLamports: Number(totals?.total_reclaimed_lamports ?? 0),
    totalAccountsClosed: Number(totals?.total_accounts_closed ?? 0),
    claims24h: Number(day?.claims24h ?? 0),
    users24h: Number(day?.users24h ?? 0),
    reclaimedLamports24h: Number(day?.reclaimed24h ?? 0),
  };

  return {
    configured: true,
    durable: true,
    claims,
    stats,
  };
}

export { EMPTY_STATS };
