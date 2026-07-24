"use client";

import { SOLSCAN_TX } from "@/lib/constants";
import { formatSol, timeAgo, truncateAddress } from "@/lib/format";
import { useLedger } from "@/lib/use-ledger";

export function LatestClaims() {
  const { data, loading } = useLedger();
  const claims = data?.claims ?? [];

  return (
    <section
      id="latest-claims"
      className="mx-auto max-w-6xl scroll-mt-20 px-3 py-12 sm:px-4 sm:py-16"
    >
      <h2 className="text-center font-pixel text-[11px] sm:text-sm sm:text-base">
        &gt; latest_claims
      </h2>
      <p className="mx-auto mt-3 max-w-xl px-2 text-center text-lg text-[var(--muted)] sm:text-xl">
        Live from the blockchain — every row links to Solscan.
      </p>

      {/* Mobile cards */}
      <div className="mt-8 space-y-3 md:hidden">
        {loading && (
          <div className="pixel-panel p-4 text-center text-[var(--muted)]">
            Loading on-chain data…
          </div>
        )}
        {!loading && claims.length === 0 && (
          <div className="pixel-panel p-4 text-center text-[var(--muted)]">
            No claims yet — be the first!
          </div>
        )}
        {claims.map((claim) => (
          <div key={claim.signature} className="pixel-panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-pixel text-[10px] text-[var(--accent)]">
                  +{formatSol(claim.reclaimedLamports)} SOL
                </p>
                <p className="mt-1 font-mono text-sm text-[var(--muted)]">
                  {truncateAddress(claim.wallet)}
                </p>
                <p className="text-sm text-[var(--muted)]">
                  {claim.accountsClosed} closed ·{" "}
                  {claim.blockTime ? timeAgo(claim.blockTime) : "—"}
                </p>
              </div>
              <a
                href={SOLSCAN_TX(claim.signature)}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[var(--accent-2)] underline"
              >
                Solscan ↗
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="mt-10 hidden overflow-x-auto pixel-panel md:block">
        <table className="w-full text-lg">
          <thead>
            <tr className="border-b-[3px] border-[var(--panel-border)] text-left font-pixel text-[9px] uppercase text-[var(--muted)]">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Wallet</th>
              <th className="px-4 py-3">Closed</th>
              <th className="px-4 py-3">SOL</th>
              <th className="px-4 py-3 text-right">Proof</th>
            </tr>
          </thead>
          <tbody className="divide-y-[2px] divide-[var(--panel-border)]/50">
            {loading && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-[var(--muted)]"
                >
                  Loading on-chain data…
                </td>
              </tr>
            )}
            {!loading && claims.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-[var(--muted)]"
                >
                  No claims yet — be the first!
                </td>
              </tr>
            )}
            {claims.map((claim) => (
              <tr key={claim.signature}>
                <td className="px-4 py-3 text-[var(--muted)]">
                  {claim.blockTime ? timeAgo(claim.blockTime) : "—"}
                </td>
                <td className="px-4 py-3 font-mono text-base">
                  {truncateAddress(claim.wallet)}
                </td>
                <td className="px-4 py-3">{claim.accountsClosed}</td>
                <td className="px-4 py-3 font-semibold text-[var(--accent)]">
                  +{formatSol(claim.reclaimedLamports)}
                </td>
                <td className="px-4 py-3 text-right">
                  <a
                    href={SOLSCAN_TX(claim.signature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent-2)] hover:underline"
                  >
                    Solscan ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
