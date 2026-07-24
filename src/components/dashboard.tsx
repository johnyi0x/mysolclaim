"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  buildClaimTransactions,
  buildPumpCashbackTransaction,
  computeFee,
  type ClaimBatch,
} from "@/lib/claim";
import {
  CLOSES_PER_TX,
  FEE_PERCENT,
  FEE_WALLET,
  SOLSCAN_ACCOUNT,
  SOLSCAN_TX,
} from "@/lib/constants";
import { formatSol, truncateAddress } from "@/lib/format";
import type { PumpCashbackOpportunity } from "@/lib/pump-cashback";
import type { EmptyTokenAccount } from "@/lib/scan";
import { notifyClaimsUpdated } from "@/lib/use-ledger";

interface BatchResult {
  signature: string;
  accountsClosed: number;
  rentLamports: number;
  feeLamports: number;
  action: "vacant_account" | "pump_cashback";
}

type Phase = "idle" | "claiming" | "done";

const SCAN_COOLDOWN_MS = 8_000;

export function Dashboard() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [accounts, setAccounts] = useState<EmptyTokenAccount[] | null>(null);
  const [pumpCashback, setPumpCashback] =
    useState<PumpCashbackOpportunity | null>(null);
  const [includePump, setIncludePump] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const lastScanAt = useRef(0);

  const scan = useCallback(async () => {
    if (!publicKey) return;

    const now = Date.now();
    if (now - lastScanAt.current < SCAN_COOLDOWN_MS) {
      const wait = Math.ceil(
        (SCAN_COOLDOWN_MS - (now - lastScanAt.current)) / 1000
      );
      setScanError(`Please wait ${wait}s before scanning again.`);
      return;
    }

    setScanning(true);
    setScanError(null);
    try {
      const res = await fetch(
        `/api/scan?owner=${encodeURIComponent(publicKey.toBase58())}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.status === 429) {
        setScanError(
          data.error ||
            `Too many scans. Retry in ${data.retryAfterSec ?? 30}s.`
        );
        setCooldownUntil(Date.now() + (data.retryAfterSec ?? 30) * 1000);
        return;
      }
      if (!res.ok) {
        setScanError(data.error || "Scan failed. Please try again.");
        return;
      }
      const found = (data.accounts ?? []) as EmptyTokenAccount[];
      const pump = (data.pumpCashback ?? null) as PumpCashbackOpportunity | null;
      setAccounts(found);
      setPumpCashback(pump);
      setIncludePump(Boolean(pump));
      setSelected(
        new Set(found.filter((a) => a.closable).map((a) => a.address))
      );
      lastScanAt.current = Date.now();
      setCooldownUntil(Date.now() + SCAN_COOLDOWN_MS);
    } catch (err) {
      console.error(err);
      setScanError("Scan failed — network error. Please try again.");
    } finally {
      setScanning(false);
    }
  }, [publicKey]);

  useEffect(() => {
    setAccounts(null);
    setPumpCashback(null);
    setResults([]);
    setPhase("idle");
    setClaimError(null);
    lastScanAt.current = 0;
    if (publicKey) scan();
  }, [publicKey]); // eslint-disable-line react-hooks/exhaustive-deps -- only on wallet change

  const closable = useMemo(
    () => (accounts ?? []).filter((a) => a.closable),
    [accounts]
  );
  const selectedAccounts = useMemo(
    () => closable.filter((a) => selected.has(a.address)),
    [closable, selected]
  );
  const selectedRent = selectedAccounts.reduce((n, a) => n + a.lamports, 0);
  const pumpLamports =
    includePump && pumpCashback ? pumpCashback.lamports : 0;
  const totalReclaimable = selectedRent + pumpLamports;
  const fee = FEE_WALLET ? computeFee(totalReclaimable) : 0;
  const netReceive = totalReclaimable - fee;
  const vacantTxCount =
    Math.ceil(selectedAccounts.length / CLOSES_PER_TX) || 0;
  const pumpTxCount = pumpLamports > 0 ? 1 : 0;
  const txCount = vacantTxCount + pumpTxCount;
  const onCooldown = Date.now() < cooldownUntil;
  const canClaim = totalReclaimable > 0 && (selectedAccounts.length > 0 || pumpLamports > 0);

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

  const sendBatch = async (
    batch: ClaimBatch,
    label: string
  ): Promise<BatchResult> => {
    setProgress(`Simulating ${label}…`);
    const sim = await connection.simulateTransaction(batch.transaction);
    if (sim.value.err) {
      const logs = (sim.value.logs ?? []).slice(-8).join(" | ");
      throw new Error(
        `Simulation failed: ${JSON.stringify(sim.value.err)}${
          logs ? ` — ${logs}` : ""
        }`
      );
    }

    setProgress(`Approve ${label} in your wallet…`);
    const signature = await sendTransaction(batch.transaction, connection, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    setProgress(`Confirming ${label}…`);
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    const confirmation = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${signature}`);
    }

    return {
      signature,
      accountsClosed: batch.accounts.length,
      rentLamports: batch.rentLamports,
      feeLamports: batch.feeLamports,
      action: batch.action,
    };
  };

  const claim = async () => {
    if (!publicKey || !canClaim) return;
    setPhase("claiming");
    setClaimError(null);
    setResults([]);

    const completed: BatchResult[] = [];
    try {
      let step = 0;
      const total = txCount;

      if (includePump && pumpCashback) {
        step++;
        setProgress(`Building Pump.fun cashback (${step}/${total})…`);
        const batch = await buildPumpCashbackTransaction(
          connection,
          publicKey,
          pumpCashback
        );
        completed.push(
          await sendBatch(batch, `Pump cashback ${step}/${total}`)
        );
        setResults([...completed]);
      }

      for (let i = 0; i < selectedAccounts.length; i += CLOSES_PER_TX) {
        const slice = selectedAccounts.slice(i, i + CLOSES_PER_TX);
        step++;
        setProgress(`Building vacant accounts (${step}/${total})…`);
        const [batch] = await buildClaimTransactions(
          connection,
          publicKey,
          slice
        );
        completed.push(
          await sendBatch(batch, `vacant accounts ${step}/${total}`)
        );
        setResults([...completed]);
      }
    } catch (err) {
      console.error(err);
      const raw = err instanceof Error ? err.message : String(err);
      const message =
        /reject|User rejected|cancelled/i.test(raw)
          ? "You declined the transaction in your wallet."
          : /Simulation failed/i.test(raw)
            ? raw.length > 280
              ? `${raw.slice(0, 280)}…`
              : raw
            : /insufficient|0x1|InsufficientFunds/i.test(raw)
              ? "Not enough SOL in your wallet to cover network fees. Keep a tiny bit of SOL unlocked, then retry."
              : "Something went wrong. Any txs you already approved are listed below.";
      setClaimError(message);
    }

    setPhase("done");
    setProgress(null);
    if (completed.length > 0) {
      notifyClaimsUpdated();
      lastScanAt.current = 0;
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
    <section className="mx-auto max-w-6xl px-3 pb-8 pt-8 sm:px-4 sm:pt-12">
      {phase === "done" && results.length > 0 && (
        <div className="mb-6 pixel-panel border-[var(--accent)] p-4 sm:mb-8 sm:p-6">
          <h2 className="font-pixel text-[10px] leading-relaxed text-[var(--accent)] sm:text-xs">
            [OK] SUCCESS
            {totalClosed > 0 ? ` — ${totalClosed} CLOSED` : ""}
          </h2>
          <p className="mt-3 text-lg text-[var(--muted)] sm:text-xl">
            You received{" "}
            <strong className="text-[var(--accent)]">
              ≈ {formatSol(totalReceived)} SOL
            </strong>{" "}
            (reclaimed − {FEE_PERCENT}% fee).
          </p>
          <ul className="mt-3 space-y-2 text-base sm:text-lg">
            {results.map((r) => (
              <li key={r.signature} className="break-all">
                <a
                  href={SOLSCAN_TX(r.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent-2)] hover:underline"
                >
                  Solscan ↗
                </a>{" "}
                <span className="text-[var(--muted)]">
                  —{" "}
                  {r.action === "pump_cashback"
                    ? "Pump.fun cashback"
                    : `${r.accountsClosed} vacant`}
                  , +{formatSol(r.rentLamports - r.feeLamports)} SOL
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {claimError && (
        <div className="mb-6 pixel-panel border-[var(--accent-2)] p-4 text-base text-[var(--accent-2)] sm:text-lg">
          {claimError}
        </div>
      )}

      <div className="pixel-panel p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="font-pixel text-[10px] leading-relaxed sm:text-xs md:text-sm">
              {scanning
                ? "> scanning…"
                : accounts === null
                  ? "> preparing…"
                  : `> total_to_claim`}
            </h1>
            {!scanning && accounts !== null && (
              <p className="mt-2 text-2xl font-semibold text-[var(--accent)] sm:text-3xl">
                {formatSol(netReceive)} SOL
              </p>
            )}
            {!scanning && accounts !== null && totalReclaimable > 0 && (
              <p className="mt-2 text-base leading-snug text-[var(--muted)] sm:text-xl">
                gross {formatSol(totalReclaimable)} − {FEE_PERCENT}% fee{" "}
                {formatSol(fee)}
                {txCount > 0
                  ? ` · sign ${txCount} tx${txCount === 1 ? "" : "s"}`
                  : ""}
              </p>
            )}
            {!scanning && accounts !== null && totalReclaimable === 0 && (
              <p className="mt-2 text-base text-[var(--muted)] sm:text-xl">
                Nothing to claim — wallet is tidy.
              </p>
            )}
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={scan}
              disabled={scanning || phase === "claiming" || onCooldown}
              className="pixel-btn pixel-btn-secondary min-h-11 w-full px-4 py-3 sm:w-auto"
            >
              Rescan
            </button>
            <button
              type="button"
              onClick={claim}
              disabled={scanning || phase === "claiming" || !canClaim}
              className="pixel-btn min-h-11 w-full px-4 py-3 sm:w-auto"
            >
              {phase === "claiming"
                ? "Waiting…"
                : `Claim ${canClaim ? `≈${formatSol(netReceive)}` : ""}`}
            </button>
          </div>
        </div>

        {progress && (
          <p className="mt-4 font-pixel text-[9px] leading-relaxed text-[var(--accent)] sm:text-[10px]">
            {progress}
            <span className="blink">_</span>
          </p>
        )}
        {scanError && (
          <p className="mt-4 text-base text-[var(--accent-2)] sm:text-lg">
            {scanError}
          </p>
        )}
      </div>

      {/* Pump.fun cashback panel */}
      {pumpCashback && (
        <div className="mt-4 pixel-panel p-4 sm:p-5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={includePump}
              onChange={(e) => setIncludePump(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-pixel text-[9px] sm:text-[10px]">
                  Pump.fun Cashback
                </h2>
                <span className="font-pixel text-[10px] text-[var(--accent)] sm:text-xs">
                  {formatSol(pumpCashback.lamports)} SOL
                </span>
              </div>
              <p className="mt-2 text-base text-[var(--muted)] sm:text-lg">
                Claim trader cashback + close your Pump volume account (rent).
                Same {FEE_PERCENT}% fee applies.
              </p>
              <a
                href={SOLSCAN_ACCOUNT(pumpCashback.accumulator)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm text-[var(--accent)] underline"
              >
                Accumulator ↗
              </a>
            </div>
          </label>
        </div>
      )}

      {/* Vacant accounts */}
      {accounts !== null && (
        <div className="mt-4">
          <h2 className="mb-3 font-pixel text-[9px] sm:text-[10px]">
            Vacant Accounts ({closable.length})
          </h2>

          {accounts.length === 0 ? (
            <div className="pixel-panel p-4 text-[var(--muted)]">
              No empty token accounts found.
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                <label className="flex min-h-11 items-center gap-3 pixel-panel px-4 py-3">
                  <input
                    type="checkbox"
                    checked={
                      closable.length > 0 && selected.size === closable.length
                    }
                    onChange={toggleAll}
                    className="h-5 w-5 accent-[var(--accent)]"
                  />
                  <span className="font-pixel text-[9px]">SELECT ALL</span>
                </label>
                {accounts.map((acc) => (
                  <label
                    key={acc.address}
                    className={`block pixel-panel p-4 ${acc.closable ? "" : "opacity-40"}`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        disabled={!acc.closable}
                        checked={selected.has(acc.address)}
                        onChange={() => toggle(acc.address)}
                        className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-pixel text-[10px] text-[var(--accent)]">
                            {formatSol(acc.lamports)} SOL
                          </span>
                          {acc.isToken2022 ? (
                            <span className="border border-[var(--accent-2)] px-2 py-0.5 text-sm text-[var(--accent-2)]">
                              T22
                            </span>
                          ) : (
                            <span className="text-sm text-[var(--muted)]">
                              SPL
                            </span>
                          )}
                        </div>
                        <p className="mt-2 break-all font-mono text-sm text-[var(--muted)]">
                          mint {truncateAddress(acc.mint, 6)}
                        </p>
                        <p className="break-all font-mono text-sm text-[var(--muted)]">
                          acct {truncateAddress(acc.address, 6)}
                        </p>
                        {!acc.closable && (
                          <p className="mt-1 text-sm text-[var(--accent-2)]">
                            {acc.reason}
                          </p>
                        )}
                        <a
                          href={SOLSCAN_ACCOUNT(acc.mint)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-sm text-[var(--accent)] underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Solscan ↗
                        </a>
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="hidden overflow-x-auto pixel-panel md:block">
                <table className="w-full text-lg">
                  <thead>
                    <tr className="border-b-[3px] border-[var(--panel-border)] text-left font-pixel text-[9px] uppercase text-[var(--muted)]">
                      <th className="w-12 px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={
                            closable.length > 0 &&
                            selected.size === closable.length
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
                      <tr
                        key={acc.address}
                        className={acc.closable ? "" : "opacity-40"}
                      >
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
            </>
          )}
        </div>
      )}
    </section>
  );
}
