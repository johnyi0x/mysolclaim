import type { Metadata } from "next";
import { FEE_PERCENT } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Terms — MySolClaim",
  description: "Terms of use for the MySolClaim non-custodial tool.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="font-pixel text-sm sm:text-base">&gt; terms</h1>
      <div className="mt-8 space-y-6 text-xl leading-snug text-[var(--muted)]">
        <p>
          <strong className="text-[var(--foreground)]">Non-custodial tool.</strong>{" "}
          MySolClaim is an interface that helps you build Solana transactions
          which close your own empty token accounts. We never hold, control or
          transmit your funds or private keys. Every transaction requires your
          explicit signature in your own wallet, and you are solely responsible
          for reviewing what you sign.
        </p>
        <p>
          <strong className="text-[var(--foreground)]">Fee.</strong> A service
          fee of {FEE_PERCENT}% of the reclaimed rent is included in each claim
          transaction and disclosed before signing. The fee is only ever taken
          from SOL you successfully reclaim.
        </p>
        <p>
          <strong className="text-[var(--foreground)]">No warranty.</strong> The
          service is provided &quot;as is&quot; without warranties of any kind.
          While closing zero-balance accounts is enforced as safe by the Solana
          Token Program itself, you use this tool at your own risk, including
          network congestion, RPC outages, or wallet issues.
        </p>
        <p>
          <strong className="text-[var(--foreground)]">
            Not financial advice.
          </strong>{" "}
          Nothing on this site is financial, legal or tax advice.
        </p>
        <p>
          <strong className="text-[var(--foreground)]">Changes.</strong> We may
          update these terms and the fee at any time; the values shown on the
          site at the moment you sign are the ones that apply to that
          transaction.
        </p>
      </div>
    </div>
  );
}
