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
      <div className="mx-auto max-w-6xl px-3 pb-12 pt-10 text-center sm:px-4 sm:pb-16 sm:pt-16">
        <p className="mx-auto w-fit max-w-full border-[3px] border-[var(--panel-border)] bg-[var(--panel)] px-3 py-1.5 font-pixel text-[8px] uppercase leading-relaxed text-[var(--accent)] shadow-[3px_3px_0_var(--panel-border)] sm:px-4 sm:text-[9px]">
          &gt; non-custodial · you_sign · on-chain
          <span className="blink">_</span>
        </p>

        <h1 className="mx-auto mt-6 max-w-4xl px-1 font-pixel text-[13px] leading-relaxed sm:mt-8 sm:text-xl md:text-2xl lg:text-3xl">
          reclaim the{" "}
          <span className="text-[var(--accent)]">SOL</span> locked in your{" "}
          <span className="text-[var(--accent-2)]">empty token accounts</span>
        </h1>

        <p className="mx-auto mt-5 max-w-2xl px-1 text-lg text-[var(--muted)] sm:mt-6 sm:text-xl">
          Every token you ever received locked ~0.002 SOL as rent. When the
          account is empty, that SOL just sits there — close the accounts and
          get it back. Scanning is free and read-only.
        </p>

        <div className="mt-7 flex flex-col items-center gap-3 sm:mt-8">
          <div className="wallet-btn-wrap w-full max-w-xs sm:w-auto sm:max-w-none">
            <WalletMultiButton />
          </div>
          <a
            href="#how-it-works"
            className="text-base uppercase text-[var(--muted)] underline underline-offset-4 hover:text-[var(--accent)] sm:text-lg"
          >
            Read how it works first ↓
          </a>
        </div>

        {stats && stats.totalClaims > 0 && (
          <div className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-2 sm:mt-12 sm:gap-3">
            {[
              {
                value: formatSol(stats.totalReclaimedLamports, 3),
                label: "SOL*",
                accent: true,
              },
              {
                value: String(stats.totalUsers),
                label: "users*",
              },
              { value: String(stats.totalClaims), label: "claims*" },
            ].map((s) => (
              <div key={s.label} className="pixel-panel p-2 sm:p-4">
                <p
                  className={`font-pixel text-[10px] leading-relaxed sm:text-sm md:text-base ${
                    s.accent ? "text-[var(--accent)]" : ""
                  }`}
                >
                  {s.value}
                </p>
                <p className="mt-1 text-xs uppercase text-[var(--muted)] sm:mt-2 sm:text-base">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        )}
        {stats && stats.totalClaims > 0 && (
          <p className="mt-3 px-2 text-sm text-[var(--muted)] sm:text-base">
            *stacked on-chain claims via fee wallet (all-time + live sync)
          </p>
        )}
      </div>
    </section>
  );
}
