"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  FEE_PERCENT,
  REFERRAL_SHARE_PERCENT,
  SOLSCAN_TX,
} from "@/lib/constants";
import { formatSol, timeAgo, truncateAddress } from "@/lib/format";
import {
  PLATFORM_SHARE_PERCENT,
  feeSplitExample,
  referralLinkFor,
} from "@/lib/referral";

interface EarningRow {
  signature: string;
  blockTime: number;
  lamports: number;
  claimant: string;
  url: string;
}

export function ReferralDashboard() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalLamports, setTotalLamports] = useState(0);
  const [payoutCount, setPayoutCount] = useState(0);
  const [recent, setRecent] = useState<EarningRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [rentWarning, setRentWarning] = useState<string | null>(null);

  const link = useMemo(
    () => (publicKey ? referralLinkFor(publicKey.toBase58()) : ""),
    [publicKey]
  );

  const example = feeSplitExample(1);

  const loadEarnings = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/referral/earnings?wallet=${encodeURIComponent(publicKey.toBase58())}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.status === 429) {
        setError(data.error || "Too many requests. Wait a moment.");
        return;
      }
      if (!res.ok) {
        setError(data.error || "Failed to load earnings.");
        return;
      }
      setTotalLamports(Number(data.totalLamports) || 0);
      setPayoutCount(Number(data.payoutCount) || 0);
      setRecent((data.recent ?? []) as EarningRow[]);
      setTruncated(Boolean(data.truncated));
    } catch {
      setError("Network error loading earnings.");
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  const checkRent = useCallback(async () => {
    if (!publicKey) {
      setRentWarning(null);
      return;
    }
    try {
      const bal = await connection.getBalance(publicKey, "confirmed");
      let rent0 = 890_880;
      try {
        rent0 = await connection.getMinimumBalanceForRentExemption(0);
      } catch {
        // fallback
      }
      if (bal < rent0 + 200_000) {
        setRentWarning(
          "Keep at least ~0.001 SOL in this wallet. If your balance is near zero, Solana may reject referral tips (InsufficientFundsForRent) and that claim pays the platform only."
        );
      } else {
        setRentWarning(null);
      }
    } catch {
      setRentWarning(
        "Could not check balance. Keep ~0.001 SOL in this wallet so referral tips can land."
      );
    }
  }, [connection, publicKey]);

  useEffect(() => {
    if (!publicKey) {
      setTotalLamports(0);
      setPayoutCount(0);
      setRecent([]);
      setError(null);
      setRentWarning(null);
      return;
    }
    void loadEarnings();
    void checkRent();
  }, [publicKey, loadEarnings, checkRent]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select the link and copy manually.");
    }
  };

  if (!publicKey) {
    return (
      <div className="pixel-panel p-5 sm:p-6">
        <h2 className="font-pixel text-[11px] text-[var(--accent)]">
          YOUR REFERRAL LINK
        </h2>
        <p className="mt-3 text-lg text-[var(--muted)] sm:text-xl">
          Connect your wallet (top right) to generate your personal referral
          link and see on-chain earnings for this wallet only.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="pixel-panel p-5 sm:p-6">
        <h2 className="font-pixel text-[11px] text-[var(--accent)]">
          YOUR REFERRAL LINK
        </h2>
        <p className="mt-2 text-base text-[var(--muted)] sm:text-lg">
          Share this URL. When someone claims after opening it,{" "}
          <strong className="text-[var(--foreground)]">
            {REFERRAL_SHARE_PERCENT}%
          </strong>{" "}
          of the service fee ({FEE_PERCENT}% of reclaimed SOL) is tipped to you
          in the same transaction. Platform keeps{" "}
          <strong className="text-[var(--foreground)]">
            {PLATFORM_SHARE_PERCENT}%
          </strong>{" "}
          of that fee.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <code className="flex-1 break-all border-[3px] border-[var(--panel-border)] bg-[var(--background)] px-3 py-3 text-sm text-[var(--foreground)] sm:text-base">
            {link}
          </code>
          <button
            type="button"
            onClick={() => void copy()}
            className="pixel-btn shrink-0 px-4 py-3 text-base uppercase"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {rentWarning && (
          <p className="mt-4 border-[3px] border-[var(--accent)] bg-[var(--background)] p-3 text-base text-[var(--foreground)] sm:text-lg">
            {rentWarning}
          </p>
        )}
        <p className="mt-3 text-base text-[var(--muted)]">
          Example on 1 SOL reclaimed: user pays {example.totalFeeSol.toFixed(4)}{" "}
          SOL fee → you get ~{example.referrerSol.toFixed(4)} SOL, platform ~
          {example.platformSol.toFixed(4)} SOL. Same{" "}
          {PLATFORM_SHARE_PERCENT}:{REFERRAL_SHARE_PERCENT} fee split if the
          site fee later changes to 5% or 20%.
        </p>
      </div>

      <div className="pixel-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-pixel text-[11px] text-[var(--accent)]">
            YOUR EARNINGS
          </h2>
          <button
            type="button"
            onClick={() => void loadEarnings()}
            disabled={loading}
            className="pixel-btn pixel-btn-secondary px-3 py-2 text-sm uppercase disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <p className="mt-2 text-base text-[var(--muted)]">
          Cumulative referral tips paid to this connected wallet only — not
          platform fee revenue. Verified from on-chain claim transactions.
        </p>
        {error && (
          <p className="mt-3 text-base text-red-500 sm:text-lg">{error}</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4">
          <div className="border-[3px] border-[var(--panel-border)] bg-[var(--background)] p-3 sm:p-4">
            <p className="font-pixel text-[9px] text-[var(--muted)]">
              TOTAL EARNED
            </p>
            <p className="mt-1 font-pixel text-sm text-[var(--accent)] sm:text-base">
              {formatSol(totalLamports)} SOL
            </p>
          </div>
          <div className="border-[3px] border-[var(--panel-border)] bg-[var(--background)] p-3 sm:p-4">
            <p className="font-pixel text-[9px] text-[var(--muted)]">
              PAYOUTS FOUND
            </p>
            <p className="mt-1 font-pixel text-sm text-[var(--foreground)] sm:text-base">
              {payoutCount}
              {truncated ? "+" : ""}
            </p>
          </div>
        </div>
        {truncated && (
          <p className="mt-3 text-base text-[var(--muted)]">
            Showing recent history only (RPC cap). Older tips may exist on
            Solscan.
          </p>
        )}
        {recent.length > 0 && (
          <ul className="mt-4 space-y-2">
            {recent.map((row) => (
              <li
                key={row.signature}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--panel-border)] pb-2 text-base text-[var(--muted)] last:border-0"
              >
                <span>
                  <span className="text-[var(--foreground)]">
                    +{formatSol(row.lamports)} SOL
                  </span>{" "}
                  from {truncateAddress(row.claimant, 4)}
                  {row.blockTime > 0 ? ` · ${timeAgo(row.blockTime)}` : ""}
                </span>
                <a
                  href={row.url || SOLSCAN_TX(row.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent)] hover:underline"
                >
                  tx ↗
                </a>
              </li>
            ))}
          </ul>
        )}
        {!loading && !error && recent.length === 0 && (
          <p className="mt-4 text-base text-[var(--muted)] sm:text-lg">
            No referral payouts found yet for this wallet. Share your link and
            keep ~0.001 SOL here so tips can land.
          </p>
        )}
      </div>
    </div>
  );
}
