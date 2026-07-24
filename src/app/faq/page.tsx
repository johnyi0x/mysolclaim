import type { Metadata } from "next";
import { Faq } from "@/components/faq";

export const metadata: Metadata = {
  title: "FAQ — MySolClaim",
  description:
    "Answers about reclaiming SOL from empty token accounts: safety, fees, wallets, Token-2022 and more.",
};

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-center font-pixel text-sm sm:text-base">
        &gt; faq
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-center text-xl text-[var(--muted)]">
        Everything you might want to know before connecting your wallet.
      </p>
      <div className="mt-10">
        <Faq />
      </div>
    </div>
  );
}
