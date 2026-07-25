import type { Metadata } from "next";
import Link from "next/link";
import { ReferralDashboard } from "@/components/referral-dashboard";
import {
  FEE_PERCENT,
  REFERRAL_SHARE_PERCENT,
} from "@/lib/constants";
import {
  PLATFORM_SHARE_PERCENT,
  feeSplitExample,
} from "@/lib/referral";

export const metadata: Metadata = {
  title: "Referral Program — MySolClaim",
  description:
    "Earn a share of MySolClaim service fees when people you refer reclaim SOL. Instant on-chain payout in the same claim transaction.",
};

export default function ReferralPage() {
  const ex = feeSplitExample(1);
  const feeAt5 = 0.05;
  const feeAt20 = 0.2;
  const refAt5 = feeAt5 * (REFERRAL_SHARE_PERCENT / 100);
  const platAt5 = feeAt5 - refAt5;
  const refAt20 = feeAt20 * (REFERRAL_SHARE_PERCENT / 100);
  const platAt20 = feeAt20 - refAt20;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="font-pixel text-sm sm:text-base">
        &gt; referral_program
      </h1>
      <p className="mt-3 text-xl text-[var(--muted)]">
        Share your link. When someone claims through it, you earn{" "}
        <strong className="text-[var(--foreground)]">
          {REFERRAL_SHARE_PERCENT}% of the service fee
        </strong>{" "}
        instantly on-chain — paid in the same transaction they sign. We never
        hold your referral balance.
      </p>

      <div className="mt-10">
        <ReferralDashboard />
      </div>

      <div className="mt-12 space-y-10 text-xl leading-snug text-[var(--muted)]">
        <section className="pixel-panel border-[var(--accent)] p-5">
          <h2 className="font-pixel text-[11px] text-[var(--accent)]">
            KEEP ~0.001 SOL IN YOUR WALLET
          </h2>
          <p className="mt-3 text-[var(--foreground)]">
            This is required for reliable payouts.
          </p>
          <p className="mt-3">
            Referral tips are small SOL transfers to your wallet inside the
            claimer’s transaction. If your wallet account does not exist yet, or
            is below rent-exempt, Solana can reject that transfer (
            <code className="text-[var(--foreground)]">
              InsufficientFundsForRent
            </code>
            ). MySolClaim then skips your tip for that claim and sends the full
            fee to the platform so the user’s reclaim still succeeds.
          </p>
          <p className="mt-3">
            Fund your receiving wallet once with about{" "}
            <strong className="text-[var(--foreground)]">0.001 SOL</strong> and
            leave it there. That is enough for rent + many small tips.
          </p>
        </section>

        <section className="pixel-panel p-5">
          <h2 className="font-pixel text-[11px] text-[var(--accent)]">
            HOW IT WORKS
          </h2>
          <ol className="mt-3 list-decimal space-y-3 pl-5">
            <li>Connect your wallet on this page and copy your referral link.</li>
            <li>
              Someone opens{" "}
              <code className="text-base text-[var(--foreground)]">
                mysolclaim.com/?ref=YOUR_WALLET
              </code>{" "}
              and later claims vacant accounts or Pump cashback.
            </li>
            <li>
              Their claim transaction still charges the normal{" "}
              <strong className="text-[var(--foreground)]">
                {FEE_PERCENT}% service fee
              </strong>{" "}
              on reclaimed SOL. They do not pay extra for using a referral.
            </li>
            <li>
              That fee is split on-chain in the same tx:{" "}
              <strong className="text-[var(--foreground)]">
                {PLATFORM_SHARE_PERCENT}% → platform
              </strong>
              ,{" "}
              <strong className="text-[var(--foreground)]">
                {REFERRAL_SHARE_PERCENT}% → you
              </strong>
              .
            </li>
            <li>
              Your earnings here are summed from those on-chain tips only — not
              from platform revenue or homepage reclaim stats.
            </li>
          </ol>
        </section>

        <section className="pixel-panel p-5">
          <h2 className="font-pixel text-[11px] text-[var(--accent)]">
            FEE RATIO STAYS {PLATFORM_SHARE_PERCENT}:{REFERRAL_SHARE_PERCENT}
          </h2>
          <p className="mt-3">
            The referral share is always{" "}
            <strong className="text-[var(--foreground)]">
              {REFERRAL_SHARE_PERCENT}% of whatever the site service fee is
            </strong>
            , not a fixed % of reclaimed SOL. If the platform fee changes later,
            the split of that fee stays {PLATFORM_SHARE_PERCENT}/
            {REFERRAL_SHARE_PERCENT}.
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-lg sm:text-xl">
            <li>
              <strong className="text-[var(--foreground)]">
                Today ({FEE_PERCENT}% fee)
              </strong>
              : on 1 SOL reclaimed → fee {ex.totalFeeSol.toFixed(3)} SOL → you ~
              {ex.referrerSol.toFixed(4)} SOL, platform ~{ex.platformSol.toFixed(4)}{" "}
              SOL.
            </li>
            <li>
              <strong className="text-[var(--foreground)]">If fee were 5%</strong>
              : on 1 SOL → fee 0.05 SOL → you ~{refAt5.toFixed(4)} SOL, platform ~
              {platAt5.toFixed(4)} SOL.
            </li>
            <li>
              <strong className="text-[var(--foreground)]">
                If fee were 20%
              </strong>
              : on 1 SOL → fee 0.20 SOL → you ~{refAt20.toFixed(4)} SOL, platform ~
              {platAt20.toFixed(4)} SOL.
            </li>
          </ul>
          <p className="mt-3 text-lg">
            Illustrations use 1 SOL reclaimed; live amounts use on-chain floor
            division.
          </p>
        </section>

        <section className="pixel-panel p-5">
          <h2 className="font-pixel text-[11px] text-[var(--accent)]">
            SECURITY &amp; ANTI-SPAM
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Links are your wallet pubkey — no custom short codes to squat or
              flood. Thousands of referrers scale without a code registry.
            </li>
            <li>Self-referrals are rejected. Fee wallet cannot be a referrer.</li>
            <li>
              First attribution wins (local + optional durable bind). Later
              links do not steal an already-attributed claimer.
            </li>
            <li>
              You never sign for someone else. Tips come from the claimer’s
              signed tx. We never custody referral balances.
            </li>
            <li>
              Bind / earnings APIs are rate-limited per IP and wallet to stop
              spam and RPC abuse.
            </li>
            <li>
              Homepage SOL / users / claims stats measure user reclaims from
              public ledger data — they are not inflated or mixed with referral
              tip accounting.
            </li>
          </ul>
        </section>

        <section className="pixel-panel p-5">
          <h2 className="font-pixel text-[11px] text-[var(--accent)]">
            FAQ SNAPSHOT
          </h2>
          <p className="mt-3">
            <strong className="text-[var(--foreground)]">
              Do referred users pay more?
            </strong>{" "}
            No. Same {FEE_PERCENT}% fee; only the fee split changes.
          </p>
          <p className="mt-3">
            <strong className="text-[var(--foreground)]">
              When am I paid?
            </strong>{" "}
            Immediately in their claim transaction — no pending balance, no
            manual withdraw from us.
          </p>
          <p className="mt-3">
            <strong className="text-[var(--foreground)]">
              Why did I miss a tip?
            </strong>{" "}
            Usually empty / under-rented receiving wallet, self-ref, or tip too
            small to create an account. Keep ~0.001 SOL funded.
          </p>
          <p className="mt-6">
            <Link href="/faq" className="text-[var(--accent)] hover:underline">
              Full site FAQ →
            </Link>
            {" · "}
            <Link
              href="/security"
              className="text-[var(--accent)] hover:underline"
            >
              Security →
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
