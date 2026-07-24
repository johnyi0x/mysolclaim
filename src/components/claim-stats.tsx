"use client";

import { formatSol } from "@/lib/format";
import { useLedger } from "@/lib/use-ledger";

export function ClaimStats() {
  const { data, loading } = useLedger();
  const stats = data?.stats;

  if (loading && !stats) {
    return (
      <section className="mx-auto max-w-6xl px-3 pb-12 sm:px-4 sm:pb-16">
        <div className="pixel-panel p-6 text-center text-[var(--muted)]">
          Loading stats…
        </div>
      </section>
    );
  }

  if (!stats) return null;

  const rows = [
    {
      title: "All time",
      items: [
        {
          label: "SOL claimed",
          value: formatSol(stats.totalReclaimedLamports, 3),
          accent: true,
        },
        { label: "Users", value: String(stats.totalUsers) },
      ],
    },
    {
      title: "Last 24h",
      items: [
        {
          label: "SOL claimed",
          value: formatSol(stats.reclaimedLamports24h, 3),
          accent: true,
        },
        { label: "Users", value: String(stats.users24h) },
      ],
    },
  ];

  return (
    <section
      id="claim-stats"
      className="mx-auto max-w-6xl scroll-mt-20 px-3 pb-12 sm:px-4 sm:pb-16"
    >
      <h2 className="text-center font-pixel text-[11px] sm:text-sm sm:text-base">
        &gt; claim_stats
      </h2>
      <p className="mx-auto mt-3 max-w-xl px-2 text-center text-lg text-[var(--muted)] sm:text-xl">
        Totals from our public fee-wallet history on-chain.
      </p>

      <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.title} className="pixel-panel p-5">
            <h3 className="font-pixel text-[9px] uppercase text-[var(--muted)] sm:text-[10px]">
              {row.title}
            </h3>
            <dl className="mt-4 space-y-3">
              {row.items.map((item) => (
                <div
                  key={item.label}
                  className="flex items-baseline justify-between gap-3"
                >
                  <dt className="text-base text-[var(--muted)] sm:text-lg">
                    {item.label}
                  </dt>
                  <dd
                    className={`font-pixel text-[11px] sm:text-sm ${
                      item.accent ? "text-[var(--accent)]" : ""
                    }`}
                  >
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
