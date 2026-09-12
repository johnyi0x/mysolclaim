"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  buildAmmWsolTransaction,
  buildBondingSolTransaction,
  buildClaimTransactions,
  buildExcessRentTransactions,
  buildUsdcCashbackTransaction,
  computeFee,
  EXCESS_PER_TX,
  type ClaimBatch,
} from "@/lib/claim";
import { confirmSignaturePolled } from "@/lib/confirm";
import {
  CLOSES_PER_TX,
  FEE_PERCENT,
  FEE_WALLET,
  SOLSCAN_ACCOUNT,
  SOLSCAN_TX,
} from "@/lib/constants";
import { formatSol, truncateAddress } from "@/lib/format";
import {
  pumpSolReclaimable,
  pumpUsdcReclaimable,
  type PumpReclaimScan,
} from "@/lib/pump-cashback";
import { getStoredReferrer } from "@/lib/referral";
import { fetchEffectiveReferrer } from "@/lib/resolve-referrer";
import type { EmptyTokenAccount, ExcessRentAccount } from "@/lib/scan";
import { notifyClaimsUpdated } from "@/lib/use-ledger";

interface BatchResult {
  signature: string;
  accountsClosed: number;
  closedAddresses: string[];
  excessAddresses: string[];
  rentLamports: number;
  usdcRaw: number;
  feeLamports: number;
  usdcFeeRaw: number;
  action: "vacant_account" | "excess_rent" | "pump_cashback" | "pump_usdc";
}

const EMPTY_PUMP: PumpReclaimScan = {
  bondingSol: null,
  ammWsol: null,
  ammUsdc: null,
  bondingUsdc: null,
};

type Phase = "idle" | "claiming" | "done";

const SCAN_COOLDOWN_MS = 8_000;
/** RPC often lags right after close — wait before rescanning. */
const POST_CLAIM_RESCAN_MS = 2_500;

export function Dashboard() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [accounts, setAccounts] = useState<EmptyTokenAccount[] | null>(null);
  const [excessAccounts, setExcessAccounts] = useState<ExcessRentAccount[]>(
    []
  );
  const [pump, setPump] = useState<PumpReclaimScan>(EMPTY_PUMP);
  const [includePumpSol, setIncludePumpSol] = useState(true);
  const [includePumpUsdc, setIncludePumpUsdc] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedExcess, setSelectedExcess] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [referralActive, setReferralActive] = useState(false);
  const lastScanAt = useRef(0);
  const postClaimRescanRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmedClosedRef = useRef<Set<string>>(new Set());
  const confirmedExcessRef = useRef<Set<string>>(new Set());
  const confirmedPumpSolRef = useRef(false);
  const confirmedPumpUsdcRef = useRef(false);

  const clearClaimedFromUi = useCallback((completed: BatchResult[]) => {
    const closed = new Set(completed.flatMap((r) => r.closedAddresses));
    const excessDone = new Set(completed.flatMap((r) => r.excessAddresses));
    const claimedPumpSol = completed.some((r) => r.action === "pump_cashback");
    const claimedPumpUsdc = completed.some((r) => r.action === "pump_usdc");

    for (const addr of closed) confirmedClosedRef.current.add(addr);
    for (const addr of excessDone) confirmedExcessRef.current.add(addr);
    if (claimedPumpSol) confirmedPumpSolRef.current = true;
    if (claimedPumpUsdc) confirmedPumpUsdcRef.current = true;

    if (closed.size > 0) {
      setAccounts((prev) =>
        prev
          ? prev.filter((a) => !confirmedClosedRef.current.has(a.address))
          : prev
      );
      setSelected((prev) => {
        const next = new Set(prev);
        for (const addr of closed) next.delete(addr);
        return next;
      });
    }
    if (excessDone.size > 0) {
      setExcessAccounts((prev) =>
        prev.filter((a) => !confirmedExcessRef.current.has(a.address))
      );
      setSelectedExcess((prev) => {
        const next = new Set(prev);
        for (const addr of excessDone) next.delete(addr);
        return next;
      });
    }
    if (claimedPumpSol || claimedPumpUsdc) {
      setPump((prev) => ({
        bondingSol: claimedPumpSol ? null : prev.bondingSol,
        ammWsol: claimedPumpSol ? null : prev.ammWsol,
        ammUsdc: claimedPumpUsdc ? null : prev.ammUsdc,
        bondingUsdc: claimedPumpUsdc ? null : prev.bondingUsdc,
      }));
      if (claimedPumpSol) setIncludePumpSol(false);
      if (claimedPumpUsdc) setIncludePumpUsdc(false);
    }
  }, []);

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
      const foundExcess = ((data.excess ?? []) as ExcessRentAccount[]).filter(
        (a) => !confirmedExcessRef.current.has(a.address)
      );
      const pumpScan = (data.pump ?? {
        bondingSol: data.pumpCashback ?? null,
        ammWsol: null,
        ammUsdc: null,
        bondingUsdc: null,
      }) as PumpReclaimScan;

      const vacant = found.filter(
        (a) => !confirmedClosedRef.current.has(a.address)
      );
      setAccounts(vacant);
      setExcessAccounts(foundExcess);

      const nextPump: PumpReclaimScan = {
        bondingSol: confirmedPumpSolRef.current ? null : pumpScan.bondingSol,
        ammWsol: confirmedPumpSolRef.current ? null : pumpScan.ammWsol,
        ammUsdc: confirmedPumpUsdcRef.current ? null : pumpScan.ammUsdc,
        bondingUsdc: confirmedPumpUsdcRef.current
          ? null
          : pumpScan.bondingUsdc,
      };
      setPump(nextPump);
      setIncludePumpSol(
        !confirmedPumpSolRef.current && pumpSolReclaimable(nextPump) > 0
      );
      setIncludePumpUsdc(
        !confirmedPumpUsdcRef.current && pumpUsdcReclaimable(nextPump) > 0
      );
      setSelected(
        new Set(vacant.filter((a) => a.closable).map((a) => a.address))
      );
      setSelectedExcess(new Set(foundExcess.map((a) => a.address)));
      lastScanAt.current = Date.now();
      setCooldownUntil(Date.now() + SCAN_COOLDOWN_MS);
    } catch (err) {
      console.error(err);
      setScanError("Scan failed — network error. Please try again.");
    } finally {
      setScanning(false);
    }
  }, [publicKey]);

  const schedulePostClaimRescan = useCallback(() => {
    if (postClaimRescanRef.current) {
      clearTimeout(postClaimRescanRef.current);
    }
    lastScanAt.current = 0;
    setProgress("Refreshing wallet…");
    postClaimRescanRef.current = setTimeout(() => {
      postClaimRescanRef.current = null;
      setProgress(null);
      void scan();
    }, POST_CLAIM_RESCAN_MS);
  }, [scan]);

  useEffect(() => {
    setAccounts(null);
    setExcessAccounts([]);
    setPump(EMPTY_PUMP);
    setResults([]);
    setPhase("idle");
    setClaimError(null);
    lastScanAt.current = 0;
    confirmedClosedRef.current = new Set();
    confirmedExcessRef.current = new Set();
    confirmedPumpSolRef.current = false;
    confirmedPumpUsdcRef.current = false;
    if (postClaimRescanRef.current) {
      clearTimeout(postClaimRescanRef.current);
      postClaimRescanRef.current = null;
    }
    setReferralActive(Boolean(getStoredReferrer()));
    if (publicKey) scan();
    return () => {
      if (postClaimRescanRef.current) {
        clearTimeout(postClaimRescanRef.current);
        postClaimRescanRef.current = null;
      }
    };
  }, [publicKey]); // eslint-disable-line react-hooks/exhaustive-deps -- only on wallet change

  const closable = useMemo(
    () => (accounts ?? []).filter((a) => a.closable),
    [accounts]
  );
  const selectedAccounts = useMemo(
    () => closable.filter((a) => selected.has(a.address)),
    [closable, selected]
  );
  const selectedExcessList = useMemo(
    () => excessAccounts.filter((a) => selectedExcess.has(a.address)),
    [excessAccounts, selectedExcess]
  );
  const selectedRent = selectedAccounts.reduce((n, a) => n + a.lamports, 0);
  const selectedExcessLamports = selectedExcessList.reduce(
    (n, a) => n + a.excessLamports,
    0
  );
  const pumpSolLamports = includePumpSol ? pumpSolReclaimable(pump) : 0;
  const pumpUsdcRaw = includePumpUsdc ? pumpUsdcReclaimable(pump) : 0;
  const totalReclaimable =
    selectedRent + selectedExcessLamports + pumpSolLamports;
  const fee = FEE_WALLET ? computeFee(totalReclaimable) : 0;
  const usdcFee = FEE_WALLET ? Math.floor((pumpUsdcRaw * FEE_PERCENT) / 100) : 0;
  const netReceive = totalReclaimable - fee;
  const netUsdc = pumpUsdcRaw - usdcFee;
  const vacantTxCount =
    Math.ceil(selectedAccounts.length / CLOSES_PER_TX) || 0;
  const excessTxCount =
    Math.ceil(selectedExcessList.length / EXCESS_PER_TX) || 0;
  const pumpSolTxCount =
    (includePumpSol && pump.bondingSol ? 1 : 0) +
    (includePumpSol && pump.ammWsol ? 1 : 0);
  const pumpUsdcTxCount =
    (includePumpUsdc && pump.ammUsdc ? 1 : 0) +
    (includePumpUsdc && pump.bondingUsdc ? 1 : 0);
  const txCount =
    vacantTxCount + excessTxCount + pumpSolTxCount + pumpUsdcTxCount;
  const onCooldown = Date.now() < cooldownUntil;
  const canClaim =
    (totalReclaimable > 0 || pumpUsdcRaw > 0) &&
    (selectedAccounts.length > 0 ||
      selectedExcessList.length > 0 ||
      pumpSolLamports > 0 ||
      pumpUsdcRaw > 0);

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

  const toggleExcess = (address: string) => {
    setSelectedExcess((prev) => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else next.add(address);
      return next;
    });
  };

  const toggleAllExcess = () => {
    setSelectedExcess((prev) =>
      prev.size === excessAccounts.length
        ? new Set()
        : new Set(excessAccounts.map((a) => a.address))
    );
  };

  const sendBatch = async (
    batch: ClaimBatch,
    label: string,
    step: number,
    total: number
  ): Promise<BatchResult> => {
    setProgress(`(${step}/${total}) Simulating ${label}…`);
    const sim = await connection.simulateTransaction(batch.transaction);
    if (sim.value.err) {
      const logs = (sim.value.logs ?? []).slice(-8).join(" | ");
      throw new Error(
        `Simulation failed: ${JSON.stringify(sim.value.err)}${
          logs ? ` — ${logs}` : ""
        }`
      );
    }

    setProgress(
      `(${step}/${total}) Approve ${label} in your wallet…`
    );
    const signature = await sendTransaction(batch.transaction, connection, {
      skipPreflight: true, // already simulated above
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });

    setProgress(`(${step}/${total}) Confirming ${label} on-chain…`);
    await confirmSignaturePolled(connection, signature);

    setProgress(
      total > step
        ? `(${step}/${total}) Confirmed! Preparing next signature…`
        : `(${step}/${total}) Confirmed! Finishing…`
    );

    return {
      signature,
      accountsClosed: batch.accounts.length,
      closedAddresses: batch.accounts.map((a) => a.address),
      excessAddresses: batch.excessAccounts.map((a) => a.address),
      rentLamports: batch.rentLamports,
      usdcRaw: batch.usdcRaw,
      feeLamports: batch.feeLamports,
      usdcFeeRaw: batch.usdcFeeRaw,
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

      // Resolve referrer once (bind + localStorage). Never blocks claim on failure.
      setProgress("Resolving referral…");
      const referrer = await fetchEffectiveReferrer(publicKey);

      if (includePumpSol && pump.bondingSol) {
        step++;
        setProgress(`(${step}/${total}) Building Pump bonding cashback…`);
        const batch = await buildBondingSolTransaction(
          connection,
          publicKey,
          pump.bondingSol,
          referrer
        );
        const result = await sendBatch(
          batch,
          "Pump bonding cashback",
          step,
          total
        );
        completed.push(result);
        setResults([...completed]);
      }

      if (includePumpSol && pump.ammWsol) {
        step++;
        setProgress(`(${step}/${total}) Building PumpSwap SOL cashback…`);
        const batch = await buildAmmWsolTransaction(
          connection,
          publicKey,
          pump.ammWsol,
          referrer
        );
        const result = await sendBatch(
          batch,
          "PumpSwap SOL cashback",
          step,
          total
        );
        completed.push(result);
        setResults([...completed]);
      }

      if (includePumpUsdc && pump.ammUsdc) {
        step++;
        setProgress(`(${step}/${total}) Building PumpSwap USDC cashback…`);
        const batch = await buildUsdcCashbackTransaction(
          connection,
          publicKey,
          pump.ammUsdc,
          referrer
        );
        const result = await sendBatch(
          batch,
          "PumpSwap USDC cashback",
          step,
          total
        );
        completed.push(result);
        setResults([...completed]);
      }

      if (includePumpUsdc && pump.bondingUsdc) {
        step++;
        setProgress(`(${step}/${total}) Building Pump USDC cashback…`);
        const batch = await buildUsdcCashbackTransaction(
          connection,
          publicKey,
          pump.bondingUsdc,
          referrer
        );
        const result = await sendBatch(batch, "Pump USDC cashback", step, total);
        completed.push(result);
        setResults([...completed]);
      }

      for (let i = 0; i < selectedAccounts.length; i += CLOSES_PER_TX) {
        const slice = selectedAccounts.slice(i, i + CLOSES_PER_TX);
        step++;
        setProgress(`(${step}/${total}) Building vacant-account claim…`);
        const [batch] = await buildClaimTransactions(
          connection,
          publicKey,
          slice,
          referrer
        );
        const result = await sendBatch(
          batch,
          "vacant accounts",
          step,
          total
        );
        completed.push(result);
        setResults([...completed]);
      }

      for (let i = 0; i < selectedExcessList.length; i += EXCESS_PER_TX) {
        const slice = selectedExcessList.slice(i, i + EXCESS_PER_TX);
        step++;
        setProgress(`(${step}/${total}) Building excess-rent claim…`);
        const [batch] = await buildExcessRentTransactions(
          connection,
          publicKey,
          slice,
          referrer
        );
        const result = await sendBatch(batch, "excess rent", step, total);
        completed.push(result);
        setResults([...completed]);
      }

      setProgress(null);
      setPhase("done");
      if (completed.length > 0) {
        clearClaimedFromUi(completed);
        notifyClaimsUpdated();
        schedulePostClaimRescan();
      }
    } catch (err) {
      console.error(err);
      const raw =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : JSON.stringify(err);
      const message =
        /reject|User rejected|cancelled|denied/i.test(raw)
          ? "You declined the transaction in your wallet."
          : /Method not allowed|not allowed/i.test(raw)
            ? `RPC blocked a required method. Redeploy may be needed. Details: ${raw}`
            : raw.length > 0
              ? raw.length > 360
                ? `${raw.slice(0, 360)}…`
                : raw
              : "Something went wrong. Any txs you already approved are listed below.";
      setClaimError(message);
      setProgress(null);
      // Keep any successful prior batches visible as "done" with partial success.
      setPhase("done");
      if (completed.length > 0) {
        setResults([...completed]);
        clearClaimedFromUi(completed);
        notifyClaimsUpdated();
        schedulePostClaimRescan();
      }
    }
  };

  if (!publicKey) return null;

  const totalReceived = results.reduce(
    (n, r) => n + r.rentLamports - r.feeLamports,
    0
  );
  const totalUsdcReceived = results.reduce(
    (n, r) => n + r.usdcRaw - r.usdcFeeRaw,
    0
  );
  const totalClosed = results.reduce((n, r) => n + r.accountsClosed, 0);

  return (
    <section className="mx-auto max-w-6xl px-3 pb-8 pt-8 sm:px-4 sm:pt-12">
      {phase === "done" && results.length > 0 && (
        <div
          id="claim-success"
          className="mb-6 pixel-panel border-[var(--accent)] p-4 sm:mb-8 sm:p-6"
        >
          <h2 className="font-pixel text-[10px] leading-relaxed text-[var(--accent)] sm:text-xs">
            [OK] CLAIM COMPLETE
            {totalClosed > 0 ? ` — ${totalClosed} ACCOUNTS` : ""}
          </h2>
          <p className="mt-3 text-lg text-[var(--muted)] sm:text-xl">
            You received about{" "}
            <strong className="text-[var(--accent)]">
              {formatSol(totalReceived)} SOL
            </strong>
            {totalUsdcReceived > 0 && (
              <>
                {" "}
                +{" "}
                <strong className="text-[var(--accent)]">
                  {(totalUsdcReceived / 1_000_000).toFixed(4)} USDC
                </strong>
              </>
            )}{" "}
            (reclaimed − {FEE_PERCENT}% fee)
            {claimError ? " from the txs that succeeded." : "."}
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
                    ? "Pump cashback (SOL)"
                    : r.action === "pump_usdc"
                      ? `Pump cashback (${(r.usdcRaw / 1_000_000).toFixed(4)} USDC)`
                      : r.action === "excess_rent"
                        ? `${r.excessAddresses.length} excess rent`
                        : `${r.accountsClosed} vacant`}
                  {r.rentLamports > 0
                    ? `, +${formatSol(r.rentLamports - r.feeLamports)} SOL`
                    : ""}
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
                {netUsdc > 0
                  ? ` + ${(netUsdc / 1_000_000).toFixed(4)} USDC`
                  : ""}
              </p>
            )}
            {!scanning &&
              accounts !== null &&
              (totalReclaimable > 0 || pumpUsdcRaw > 0) && (
              <p className="mt-2 text-base leading-snug text-[var(--muted)] sm:text-xl">
                {totalReclaimable > 0 && (
                  <>
                    gross {formatSol(totalReclaimable)} − {FEE_PERCENT}% fee{" "}
                    {formatSol(fee)}
                  </>
                )}
                {pumpUsdcRaw > 0 && (
                  <>
                    {totalReclaimable > 0 ? " · " : ""}
                    USDC {(pumpUsdcRaw / 1_000_000).toFixed(4)} − {FEE_PERCENT}%
                    fee {(usdcFee / 1_000_000).toFixed(4)}
                  </>
                )}
                {txCount > 0
                  ? ` · sign ${txCount} tx${txCount === 1 ? "" : "s"}`
                  : ""}
                {referralActive
                  ? " · referral attributed (fee split on-chain)"
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
                : `Claim ${
                    canClaim
                      ? `≈${formatSol(netReceive)}${
                          netUsdc > 0
                            ? ` +${(netUsdc / 1_000_000).toFixed(2)}U`
                            : ""
                        }`
                      : ""
                  }`}
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

      {/* Pump cashback panels */}
      {(pumpSolReclaimable(pump) > 0 || pumpUsdcReclaimable(pump) > 0) && (
        <div className="mt-4 space-y-3">
          {pumpSolReclaimable(pump) > 0 && (
            <div className="pixel-panel p-4 sm:p-5">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={includePumpSol}
                  onChange={(e) => setIncludePumpSol(e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-pixel text-[9px] sm:text-[10px]">
                      Pump / PumpSwap SOL Cashback
                    </h2>
                    <span className="font-pixel text-[10px] text-[var(--accent)] sm:text-xs">
                      {formatSol(pumpSolReclaimable(pump))} SOL
                    </span>
                  </div>
                  <p className="mt-2 text-base text-[var(--muted)] sm:text-lg">
                    Bonding-curve SOL
                    {pump.bondingSol
                      ? ` (${formatSol(pump.bondingSol.lamports)})`
                      : ""}
                    {pump.ammWsol
                      ? ` · PumpSwap WSOL (${formatSol(pump.ammWsol.amount)})`
                      : ""}
                    . Same {FEE_PERCENT}% fee applies.
                  </p>
                </div>
              </label>
            </div>
          )}
          {pumpUsdcReclaimable(pump) > 0 && (
            <div className="pixel-panel p-4 sm:p-5">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={includePumpUsdc}
                  onChange={(e) => setIncludePumpUsdc(e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-pixel text-[9px] sm:text-[10px]">
                      Pump / PumpSwap USDC Cashback
                    </h2>
                    <span className="font-pixel text-[10px] text-[var(--accent)] sm:text-xs">
                      {(pumpUsdcReclaimable(pump) / 1_000_000).toFixed(4)} USDC
                    </span>
                  </div>
                  <p className="mt-2 text-base text-[var(--muted)] sm:text-lg">
                    Claims USDC trader cashback to your wallet. {FEE_PERCENT}%
                    fee taken in USDC (+ tiny SOL tip for ledger).
                  </p>
                </div>
              </label>
            </div>
          )}
        </div>
      )}

      {/* Excess rent after SIMD-0437 rent reduction */}
      {excessAccounts.length > 0 && (
        <div className="mt-4">
          <h2 className="mb-3 font-pixel text-[9px] sm:text-[10px]">
            Excess Rent ({excessAccounts.length})
          </h2>
          <p className="mb-3 text-base text-[var(--muted)] sm:text-lg">
            Solana lowered the rent floor — withdraw surplus SOL without closing
            these accounts (tokens stay). Same {FEE_PERCENT}% fee applies.
          </p>
          <div className="space-y-3 md:hidden">
            <label className="flex min-h-11 items-center gap-3 pixel-panel px-4 py-3">
              <input
                type="checkbox"
                checked={
                  excessAccounts.length > 0 &&
                  selectedExcess.size === excessAccounts.length
                }
                onChange={toggleAllExcess}
                className="h-5 w-5 accent-[var(--accent)]"
              />
              <span className="font-pixel text-[9px]">SELECT ALL</span>
            </label>
            {excessAccounts.map((acc) => (
              <label key={acc.address} className="block pixel-panel p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedExcess.has(acc.address)}
                    onChange={() => toggleExcess(acc.address)}
                    className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-pixel text-[10px] text-[var(--accent)]">
                        +{formatSol(acc.excessLamports)} SOL
                      </span>
                      {acc.isToken2022 ? (
                        <span className="border border-[var(--accent-2)] px-2 py-0.5 text-sm text-[var(--accent-2)]">
                          T22
                        </span>
                      ) : (
                        <span className="text-sm text-[var(--muted)]">SPL</span>
                      )}
                    </div>
                    <p className="mt-2 break-all font-mono text-sm text-[var(--muted)]">
                      mint {truncateAddress(acc.mint, 6)}
                    </p>
                    <p className="mt-1 break-all font-mono text-sm text-[var(--muted)]">
                      acct {truncateAddress(acc.address, 6)}
                    </p>
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] border-collapse text-left text-lg">
              <thead>
                <tr className="border-b-[3px] border-[var(--panel-border)] text-[var(--muted)]">
                  <th className="p-3">
                    <input
                      type="checkbox"
                      checked={
                        excessAccounts.length > 0 &&
                        selectedExcess.size === excessAccounts.length
                      }
                      onChange={toggleAllExcess}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                  </th>
                  <th className="p-3 font-pixel text-[9px]">MINT</th>
                  <th className="p-3 font-pixel text-[9px]">ACCOUNT</th>
                  <th className="p-3 font-pixel text-[9px]">TYPE</th>
                  <th className="p-3 font-pixel text-[9px]">EXCESS</th>
                </tr>
              </thead>
              <tbody>
                {excessAccounts.map((acc) => (
                  <tr
                    key={acc.address}
                    className="border-b border-[var(--panel-border)]"
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selectedExcess.has(acc.address)}
                        onChange={() => toggleExcess(acc.address)}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </td>
                    <td className="p-3 font-mono text-base">
                      {truncateAddress(acc.mint, 6)}
                    </td>
                    <td className="p-3 font-mono text-base">
                      <a
                        href={SOLSCAN_ACCOUNT(acc.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--accent)] hover:underline"
                      >
                        {truncateAddress(acc.address, 6)}
                      </a>
                    </td>
                    <td className="p-3 text-base text-[var(--muted)]">
                      {acc.isToken2022 ? "T22" : "SPL"}
                    </td>
                    <td className="p-3 font-pixel text-[10px] text-[var(--accent)]">
                      {formatSol(acc.excessLamports)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
