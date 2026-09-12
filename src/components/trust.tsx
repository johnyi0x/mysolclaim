import Link from "next/link";
import { SOLSCAN_ACCOUNT } from "@/lib/constants";
import { readFeeConfigFromEnv } from "@/lib/fee-config";

export function Trust() {
  const { feePercent, feeWallet } = readFeeConfigFromEnv();

  const points = [
    {
      title: "NON-CUSTODIAL",
      text: "Your private keys never leave your wallet. Reclaimed SOL goes from the closed account directly to you — never through us.",
    },
    {
      title: "YOU SIGN EVERY TX",
      text: "Nothing happens without your approval. Your wallet simulates each transaction and shows the exact SOL you receive before you sign.",
    },
    {
      title: "ZERO BALANCE ONLY",
      text: "The Solana Token Program itself rejects closing any account that still holds tokens. That rule is enforced on-chain, not by our code.",
    },
    {
      title: `${feePercent}% FEE — TRANSPARENT`,
      text: "Fee is taken inside the same transaction you sign. You never pay out of pocket — only from SOL you successfully reclaim.",
    },
    {
      title: "NO FUND-TOUCHING BACKEND",
      text: "Scanning and tx building happen in your browser against the blockchain. No database of wallets. No seed phrase input — ever.",
    },
    {
      title: "VERIFY ON-CHAIN",
      text: "Every fee is public on our fee wallet. The Latest Claims table is built from that same public history.",
    },
  ];

  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <h2 className="text-center font-pixel text-sm sm:text-base">
        &gt; why_this_is_safe
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-center text-xl text-[var(--muted)]">
        Don&apos;t trust our words — verify on the blockchain and in your wallet
        before you sign.
      </p>
      <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {points.map((point) => (
          <div key={point.title} className="pixel-panel p-5">
            <h3 className="font-pixel text-[10px] leading-relaxed text-[var(--accent)]">
              [OK] {point.title}
            </h3>
            <p className="mt-3 text-lg leading-snug text-[var(--muted)]">
              {point.text}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-lg">
        {feeWallet && (
          <a
            href={SOLSCAN_ACCOUNT(feeWallet)}
            target="_blank"
            rel="noopener noreferrer"
            className="pixel-btn pixel-btn-secondary px-4 py-2"
          >
            Fee wallet on Solscan ↗
          </a>
        )}
        <Link href="/security" className="pixel-btn pixel-btn-secondary px-4 py-2">
          Full security model →
        </Link>
      </div>
    </section>
  );
}
