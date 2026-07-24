"use client";

import dynamic from "next/dynamic";
import { formatSol } from "@/lib/format";
import { useLedger } from "@/lib/use-ledger";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (m) => m.WalletMultiButton
    ),
  { ssr: false }
);

export function Hero() {
  const { data } = useLedger();
  const stats = data?.stats;

  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-16 text-center">
        <p className="mx-auto w-fit border-[3px] border-[var(--panel-border)] bg-[var(--panel)] px-4 py-1 font-pixel text-[9px] uppercase text-[var(--accent)] shadow-[3px_3px_0_var(--panel-border)]">
          &gt; non-custodial_ · you_sign · on-chain_proof
          <span className="blink">_</span>
        </p>

        <h1 className="mx-auto mt-8 max-w-4xl font-pixel text-xl leading-relaxed sm:text-2xl md:text-3xl">
          reclaim the{" "}
          <span className="text-[var(--accent)]">SOL</span> locked in your{" "}
          <span className="text-[var(--accent-2)]">empty token accounts</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-xl text-[var(--muted)]">
          Every token you ever received locked ~0.002 SOL as rent. When the
          account is empty, that SOL just sits there — close the accounts and
          get it back. Scanning is free and read-only.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3">
          <WalletMultiButton />
          <a
            href="#how-it-works"
            className="text-lg uppercase text-[var(--muted)] underline underline-offset-4 hover:text-[var(--accent)]"
          >
            Read how it works first ↓
          </a>
        </div>

        {stats && stats.totalClaims > 0 && (
          <div className="mx-auto mt-12 grid max-w-2xl grid-cols-3 gap-3">
            {[
              {
                value: formatSol(stats.totalReclaimedLamports, 3),
                label: "SOL reclaimed*",
                accent: true,
              },
              {
                value: String(stats.totalAccountsClosed),
                label: "accounts closed*",
              },
              { value: String(stats.totalClaims), label: "claims*" },
            ].map((s) => (
              <div key={s.label} className="pixel-panel p-4">
                <p
                  className={`font-pixel text-sm sm:text-base ${
                    s.accent ? "text-[var(--accent)]" : ""
                  }`}
                >
                  {s.value}
                </p>
                <p className="mt-2 text-base uppercase text-[var(--muted)]">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        )}
        {stats && stats.totalClaims > 0 && (
          <p className="mt-3 text-base text-[var(--muted)]">
            *from recent on-chain history of our public fee wallet
          </p>
        )}
      </div>
    </section>
  );
}
