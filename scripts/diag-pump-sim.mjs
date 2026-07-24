/**
 * Diagnostic v2: fix simulate + decode known ix account metas
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  Keypair,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import bs58 from "bs58";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
const USER_VOLUME_SEED = Buffer.from("user_volume_accumulator");
const EVENT_AUTHORITY_SEED = Buffer.from("__event_authority");

const CLAIM_CASHBACK_V2_DISC = Buffer.from([122, 243, 204, 65, 94, 116, 29, 55]);
const CLOSE_USER_VOLUME_DISC = Buffer.from([249, 69, 164, 218, 150, 103, 84, 138]);
const CLAIM_CASHBACK_LEGACY_DISC = Buffer.from([37, 58, 35, 126, 190, 53, 228, 197]);

const KNOWN_USER = new PublicKey("BsNmcksjyCYVHXq5eMUEsQSzPSoJDihmDgZ6ekiLRcKz");
const KNOWN_TX =
  "3iZ5LhKqsCtaFDJghyMy4gyJTY4Webx7GrCLt9nokgLzZhis4ns1NSwKXgNHbFQH44SeZ3BFediYwW6WCy2ZGoh4";

function getUserVolumeAccumulatorPda(user) {
  const [pda] = PublicKey.findProgramAddressSync(
    [USER_VOLUME_SEED, user.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}

function getPumpEventAuthority() {
  const [pda] = PublicKey.findProgramAddressSync(
    [EVENT_AUTHORITY_SEED],
    PUMP_PROGRAM_ID
  );
  return pda;
}

function buildClaimCashbackV2Ix(user) {
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
  console.log("  claim_v2 accounts:");
  console.log("    user", user.toBase58());
  console.log("    accumulator", accumulator.toBase58());
  console.log("    associatedAccumulator", associatedAccumulator.toBase58());
  console.log("    associatedUser", associatedUser.toBase58());
  console.log("    eventAuthority", eventAuthority.toBase58());
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

function buildClaimCashbackLegacyIx(user) {
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
    data: CLAIM_CASHBACK_LEGACY_DISC,
  });
}

function buildCloseUserVolumeIx(user) {
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

function lastLogs(logs, n = 15) {
  if (!logs || !logs.length) return ["(no logs)"];
  return logs.slice(-n);
}

async function rpcSimulate(rpcUrl, tx, config, label) {
  console.log(`\n========== RAW RPC SIM: ${label} ==========`);
  console.log("config:", JSON.stringify(config));
  let wire;
  try {
    wire = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");
  } catch (e) {
    console.log("serialize failed:", e?.message || e);
    return null;
  }
  console.log("wire bytes approx:", Math.floor((wire.length * 3) / 4));

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "simulateTransaction",
    params: [wire, config],
  };
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) {
    console.log("RPC error:", JSON.stringify(json.error));
    return null;
  }
  const v = json.result?.value;
  console.log("err:", JSON.stringify(v?.err));
  console.log("unitsConsumed:", v?.unitsConsumed);
  console.log("last 15 logs:");
  for (const line of lastLogs(v?.logs, 15)) console.log("  ", line);
  return v;
}

async function web3Simulate(connection, tx, opts, label) {
  console.log(`\n========== web3.js SIM: ${label} ==========`);
  console.log("opts:", JSON.stringify(opts));
  try {
    const sim = await connection.simulateTransaction(tx, opts);
    console.log("err:", JSON.stringify(sim.value.err));
    console.log("unitsConsumed:", sim.value.unitsConsumed);
    console.log("last 15 logs:");
    for (const line of lastLogs(sim.value.logs, 15)) console.log("  ", line);
    return sim.value;
  } catch (e) {
    console.log("simulate threw:", e?.message || e);
    if (e?.stack) console.log(e.stack.split("\n").slice(0, 6).join("\n"));
    return null;
  }
}

function buildTx(user, ixs, feeWallet, reclaimableLamports, blockhash) {
  const tx = new Transaction();
  tx.feePayer = user;
  tx.recentBlockhash = blockhash;
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })
  );
  for (const ix of ixs) tx.add(ix);
  if (feeWallet && reclaimableLamports > 0) {
    const fee = Math.floor((reclaimableLamports * 10) / 100);
    if (fee > 0) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user,
          toPubkey: feeWallet,
          lamports: Math.min(fee, reclaimableLamports),
        })
      );
    }
  }
  // Ensure signatures array length matches (unsigned)
  tx.signatures = [{ publicKey: user, signature: null }];
  return tx;
}

async function decodeKnownTxAccounts(connection) {
  console.log("\n========== Decode known tx account metas ==========");
  const tx = await connection.getTransaction(KNOWN_TX, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!tx) {
    console.log("tx missing");
    return;
  }
  const msg = tx.transaction.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const header = msg.header;
  console.log("header:", header);
  console.log("keys:");
  keys.forEach((k, i) => console.log(`  [${i}] ${k}`));

  for (let i = 0; i < msg.compiledInstructions.length; i++) {
    const ix = msg.compiledInstructions[i];
    const prog = keys[ix.programIdIndex];
    const data = Buffer.from(ix.data);
    const disc = [...data.slice(0, 8)];
    console.log(`\nix[${i}] program=${prog}`);
    console.log(`  disc=${JSON.stringify(disc)} len=${data.length}`);
    console.log(`  accountKeyIndexes=${JSON.stringify([...ix.accountKeyIndexes])}`);
    for (const idx of ix.accountKeyIndexes) {
      const isSigner = idx < header.numRequiredSignatures;
      const isWritable =
        idx < header.numRequiredSignatures - header.numReadonlySignedAccounts ||
        (idx >= header.numRequiredSignatures &&
          idx <
            keys.length -
              header.numReadonlyUnsignedAccounts);
      // clearer writable check via message
      console.log(`    [${idx}] ${keys[idx]}`);
    }
  }

  // Also print message account metas via getAccountKeys helpers if available
  console.log("\nResolved claim_v2 / close from known tx (by disc):");
  for (const ix of msg.compiledInstructions) {
    const data = Buffer.from(ix.data);
    const head = Buffer.from(data.slice(0, 8));
    const name = head.equals(CLAIM_CASHBACK_V2_DISC)
      ? "ClaimCashbackV2"
      : head.equals(CLOSE_USER_VOLUME_DISC)
        ? "CloseUserVolumeAccumulator"
        : null;
    if (!name) continue;
    console.log(`\n${name} accounts in order:`);
    ix.accountKeyIndexes.forEach((idx, j) => {
      console.log(`  ${j}: ${keys[idx]}`);
    });
  }
}

async function checkAccumulator(connection, user, label) {
  const pda = getUserVolumeAccumulatorPda(user);
  const info = await connection.getAccountInfo(pda, "confirmed");
  console.log(`\n--- Accumulator: ${label} ---`);
  console.log("user:", user.toBase58());
  console.log("pda:", pda.toBase58());
  if (!info) {
    console.log("status: CLOSED / missing");
    return null;
  }
  console.log("owner:", info.owner.toBase58());
  console.log("lamports:", info.lamports, `(${(info.lamports / 1e9).toFixed(6)} SOL)`);
  console.log("dataLen:", info.data.length);
  const rent = await connection.getMinimumBalanceForRentExemption(info.data.length);
  console.log("rentExempt:", rent);
  console.log("cashbackAboveRent:", Math.max(0, info.lamports - rent));
  if (!info.owner.equals(PUMP_PROGRAM_ID) || info.lamports <= 0) return null;
  return { user, pda, lamports: info.lamports, rent, dataLen: info.data.length };
}

async function findLive(connection) {
  console.log("\n========== Find live accumulator via recent pump sigs ==========");
  const sigs = await connection.getSignaturesForAddress(PUMP_PROGRAM_ID, {
    limit: 25,
  });
  for (const s of sigs) {
    const tx = await connection.getTransaction(s.signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) continue;
    const keys = tx.transaction.message.staticAccountKeys || [];
    const feePayer = keys[0];
    if (!feePayer) continue;
    const opp = await checkAccumulator(
      connection,
      feePayer,
      `sig ${s.signature.slice(0, 10)}...`
    );
    if (opp && opp.lamports > 1_500_000) return opp;
  }
  return null;
}

async function main() {
  console.log("=== Pump cashback diagnostic v2 ===\n");
  console.log("Env: .env.local=", existsSync(resolve(ROOT, ".env.local")),
    ".env=", existsSync(resolve(ROOT, ".env")));
  console.log("HELIUS_RPC_URL: (not set)");
  console.log("NEXT_PUBLIC_FEE_WALLET: (not set)");

  const rpcUrl = "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: false,
  });
  const feeWallet = Keypair.generate().publicKey;
  console.log("Dummy fee wallet:", feeWallet.toBase58());

  await decodeKnownTxAccounts(connection);
  await checkAccumulator(connection, KNOWN_USER, "BsNmcks known");

  let live = await findLive(connection);
  if (!live) {
    console.log("No live found; using known closed user for error shape");
    live = {
      user: KNOWN_USER,
      pda: getUserVolumeAccumulatorPda(KNOWN_USER),
      lamports: 0,
      rent: 0,
    };
  }

  const user = live.user;
  console.log("\n========== Sims for", user.toBase58(), "==========");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  console.log("\nBuilding A accounts...");
  const txA = buildTx(
    user,
    [buildClaimCashbackV2Ix(user), buildCloseUserVolumeIx(user)],
    feeWallet,
    live.lamports || 2_039_280,
    blockhash
  );
  const txB = buildTx(user, [buildCloseUserVolumeIx(user)], null, 0, blockhash);
  const txC = buildTx(
    user,
    [buildClaimCashbackLegacyIx(user), buildCloseUserVolumeIx(user)],
    feeWallet,
    live.lamports || 2_039_280,
    blockhash
  );

  const good = {
    encoding: "base64",
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  };

  await rpcSimulate(rpcUrl, txA, good, "A) claim_v2 + close + fee");
  await rpcSimulate(rpcUrl, txB, good, "B) close only");
  await rpcSimulate(rpcUrl, txC, good, "C) legacy claim + close");

  // web3.js path (may still throw)
  await web3Simulate(
    connection,
    txA,
    { sigVerify: false, replaceRecentBlockhash: true },
    "A via web3"
  );

  // Without sigVerify:false — expect signature failure
  console.log("\n========== SigVerify experiments ==========");
  await rpcSimulate(
    rpcUrl,
    txA,
    { encoding: "base64", commitment: "confirmed" },
    "A) default (sigVerify omitted)"
  );
  await rpcSimulate(
    rpcUrl,
    txA,
    {
      encoding: "base64",
      sigVerify: true,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    },
    "A) sigVerify:true + replaceRecentBlockhash:true"
  );
  await rpcSimulate(
    rpcUrl,
    txA,
    { encoding: "base64", sigVerify: true, commitment: "confirmed" },
    "A) sigVerify:true only (no replace)"
  );

  console.log("\n=== Done ===");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
