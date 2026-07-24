"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { buildClaimTransactions, computeFee } from "@/lib/claim";
import {
  CLOSES_PER_TX,
  FEE_PERCENT,
  FEE_WALLET,
  SOLSCAN_ACCOUNT,
  SOLSCAN_TX,
} from "@/lib/constants";
import { formatSol, truncateAddress } from "@/lib/format";
import { findEmptyTokenAccounts, type EmptyTokenAccount } from "@/lib/scan";
import { notifyClaimsUpdated } from "@/lib/use-ledger";

interface BatchResult {
  signature: string;
  accountsClosed: number;
  rentLamports: number;
  feeLamports: number;
}

type Phase = "idle" | "claiming" | "done";

export function Dashboard() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [accounts, setAccounts] = useState<EmptyTokenAccount[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [claimError, setClaimError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    if (!publicKey) return;
    setScanning(true);
    setScanError(null);
    try {
      const found = await findEmptyTokenAccounts(connection, publicKey);
      setAccounts(found);
      setSelected(new Set(found.filter((a) => a.closable).map((a) => a.address)));
    } catch (err) {
      console.error(err);
      setScanError(
        "Scan failed — the RPC may be rate-limited. Please try again in a moment."
      );
    } finally {
      setScanning(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    setAccounts(null);
    setResults([]);
    setPhase("idle");
    setClaimError(null);
    if (publicKey) scan();
  }, [publicKey, scan]);

  const closable = useMemo(
    () => (accounts ?? []).filter((a) => a.closable),
    [accounts]
  );
  const selectedAccounts = useMemo(
    () => closable.filter((a) => selected.has(a.address)),
    [closable, selected]
  );
  const selectedRent = selectedAccounts.reduce((n, a) => n + a.lamports, 0);
  const fee = FEE_WALLET ? computeFee(selectedRent) : 0;
  const netReceive = selectedRent - fee;
  const txCount = Math.ceil(selectedAccounts.length / CLOSES_PER_TX) || 0;

  const toggle = (address: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else next.add(address);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === closable.length
        ? new Set()
        : new Set(closable.map((a) => a.address))
    );
  };

  const claim = async () => {
    if (!publicKey || selectedAccounts.length === 0) return;
    setPhase("claiming");
    setClaimError(null);
    setResults([]);

    const completed: BatchResult[] = [];
    try {
      // Build one batch at a time with a fresh blockhash right before signing.
      for (let i = 0; i < selectedAccounts.length; i += CLOSES_PER_TX) {
        const slice = selectedAccounts.slice(i, i + CLOSES_PER_TX);
        const batchIndex = Math.floor(i / CLOSES_PER_TX) + 1;
        const totalBatches = Math.ceil(
          selectedAccounts.length / CLOSES_PER_TX
        );

        setProgress(
          totalBatches > 1
            ? `Building tx ${batchIndex}/${totalBatches}…`
            : "Building transaction…"
        );

        const [batch] = await buildClaimTransactions(
          connection,
          publicKey,
          slice
        );

        // Simulate before asking the user to sign — fail closed on errors.
        setProgress(
          totalBatches > 1
            ? `Simulating tx ${batchIndex}/${totalBatches}…`
            : "Simulating transaction…"
        );
        const sim = await connection.simulateTransaction(batch.transaction);
        if (sim.value.err) {
          throw new Error(
            `Simulation failed: ${JSON.stringify(sim.value.err)}`
          );
        }

        setProgress(
          totalBatches > 1
            ? `Transaction ${batchIndex} of ${totalBatches} — approve in your wallet…`
            : "Approve the transaction in your wallet…"
        );

        const signature = await sendTransaction(batch.transaction, connection, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });

        setProgress(
          totalBatches > 1
            ? `Confirming transaction ${batchIndex} of ${totalBatches}…`
            : "Confirming on-chain…"
        );

        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        const confirmation = await connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed"
        );
        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${signature}`);
        }

        completed.push({
          signature,
          accountsClosed: batch.accounts.length,
          rentLamports: batch.rentLamports,
          feeLamports: batch.feeLamports,
        });
        setResults([...completed]);
      }
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error && /reject|User rejected|cancelled/i.test(err.message)
          ? "You declined the transaction in your wallet."
          : err instanceof Error && /Simulation failed/i.test(err.message)
            ? "Transaction simulation failed — nothing was signed. Rescan and try again."
            : "Something went wrong sending a transaction. Any transactions you already approved are listed below.";
      setClaimError(message);
    }

    setPhase("done");
    setProgress(null);
    if (completed.length > 0) {
      notifyClaimsUpdated();
      scan();
    }
  };

  if (!publicKey) return null;

  const totalReceived = results.reduce(
    (n, r) => n + r.rentLamports - r.feeLamports,
    0
  );
  const totalClosed = results.reduce((n, r) => n + r.accountsClosed, 0);

  return (
    <section className="mx-auto max-w-6xl px-4 pb-8 pt-12">
      {phase === "done" && results.length > 0 && (
        <div className="mb-8 pixel-panel border-[var(--accent)] p-6">
          <h2 className="font-pixel text-xs text-[var(--accent)]">
            [OK] SUCCESS — {totalClosed} ACCOUNT
            {totalClosed === 1 ? "" : "S"} CLOSED
          </h2>
          <p className="mt-3 text-xl text-[var(--muted)]">
            You received{" "}
            <strong className="text-[var(--accent)]">
              ≈ {formatSol(totalReceived)} SOL
            </strong>{" "}
            (rent − {FEE_PERCENT}% fee). Network fees are tiny.
          </p>
          <ul className="mt-3 space-y-1 text-lg">
            {results.map((r) => (
              <li key={r.signature}>
                <a
                  href={SOLSCAN_TX(r.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent-2)] hover:underline"
                >
                  View on Solscan ↗
                </a>{" "}
                <span className="text-[var(--muted)]">
                  — {r.accountsClosed} accounts, +
                  {formatSol(r.rentLamports - r.feeLamports)} SOL
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {claimError && (
        <div className="mb-8 pixel-panel border-[var(--accent-2)] p-4 text-lg text-[var(--accent-2)]">
          {claimError}
        </div>
      )}

      <div className="pixel-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-pixel text-xs sm:text-sm">
              {scanning
                ? "> scanning…"
                : accounts === null
                  ? "> preparing…"
                  : `> ${closable.length} empty account${closable.length === 1 ? "" : "s"} found`}
            </h1>
            {!scanning && accounts !== null && closable.length > 0 && (
              <p className="mt-2 text-xl text-[var(--muted)]">
                {selectedAccounts.length} selected · rent{" "}
                {formatSol(selectedRent)} − {FEE_PERCENT}% fee{" "}
                {formatSol(fee)} ={" "}
                <strong className="text-[var(--accent)]">
                  you receive ≈ {formatSol(netReceive)} SOL
                </strong>
              </p>
            )}
            {!scanning && accounts !== null && closable.length === 0 && (
              <p className="mt-2 text-xl text-[var(--muted)]">
                No reclaimable rent right now — wallet is tidy.
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={scan}
              disabled={scanning || phase === "claiming"}
              className="pixel-btn pixel-btn-secondary px-4 py-2"
            >
              Rescan
            </button>
            <button
              type="button"
              onClick={claim}
              disabled={
                scanning || phase === "claiming" || selectedAccounts.length === 0
              }
              className="pixel-btn px-4 py-2"
            >
              {phase === "claiming"
                ? "Waiting…"
                : `Claim ${selectedAccounts.length > 0 ? `≈${formatSol(netReceive)}` : ""}`}
            </button>
          </div>
        </div>

        {progress && (
          <p className="mt-4 font-pixel text-[10px] text-[var(--accent)]">
            {progress}
            <span className="blink">_</span>
          </p>
        )}
        {txCount > 1 && phase !== "claiming" && selectedAccounts.length > 0 && (
          <p className="mt-4 text-lg text-[var(--muted)]">
            Split into {txCount} txs (~{CLOSES_PER_TX} closes each). Your wallet
            will ask you to approve each one.
          </p>
        )}
        {scanError && (
          <p className="mt-4 text-lg text-[var(--accent-2)]">{scanError}</p>
        )}
      </div>

      {accounts !== null && accounts.length > 0 && (
        <div className="mt-6 overflow-x-auto pixel-panel">
          <table className="w-full text-lg">
            <thead>
              <tr className="border-b-[3px] border-[var(--panel-border)] text-left font-pixel text-[9px] uppercase text-[var(--muted)]">
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={
                      closable.length > 0 && selected.size === closable.length
                    }
                    onChange={toggleAll}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </th>
                <th className="px-4 py-3">Mint</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Rent</th>
              </tr>
            </thead>
            <tbody className="divide-y-[2px] divide-[var(--panel-border)]/40">
              {accounts.map((acc) => (
                <tr key={acc.address} className={acc.closable ? "" : "opacity-40"}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select account ${acc.address}`}
                      disabled={!acc.closable}
                      checked={selected.has(acc.address)}
                      onChange={() => toggle(acc.address)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-base">
                    <a
                      href={SOLSCAN_ACCOUNT(acc.mint)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-[var(--accent)] hover:underline"
                    >
                      {truncateAddress(acc.mint, 6)}
                    </a>
                  </td>
                  <td className="px-4 py-3 font-mono text-base text-[var(--muted)]">
                    {truncateAddress(acc.address, 6)}
                  </td>
                  <td className="px-4 py-3 text-base">
                    {acc.isToken2022 ? (
                      <span className="border border-[var(--accent-2)] px-2 py-0.5 text-[var(--accent-2)]">
                        T22
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]">SPL</span>
                    )}
                    {!acc.closable && (
                      <span className="ml-2 text-[var(--muted)]">
                        ({acc.reason})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {formatSol(acc.lamports)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
