import type { Metadata } from "next";
import {
  FEE_PERCENT,
  FEE_WALLET_ADDRESS,
  SOLSCAN_ACCOUNT,
} from "@/lib/constants";

export const metadata: Metadata = {
  title: "Security & Verification — MySolClaim",
  description:
    "The full security model of MySolClaim: non-custodial architecture, on-chain enforcement, transparent fees, and how to verify everything yourself.",
};

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="font-pixel text-sm sm:text-base">
        &gt; security_verification
      </h1>
      <p className="mt-3 text-xl text-[var(--muted)]">
        Everything on this page can be independently verified — on the
        blockchain, in your wallet, or in official Solana documentation.
      </p>

      <div className="mt-10 space-y-10 text-xl leading-snug text-[var(--muted)]">
        <section className="pixel-panel p-5">
          <h2 className="font-pixel text-[11px] text-[var(--accent)]">
            ARCHITECTURE
          </h2>
          <p className="mt-3">
            MySolClaim is a static website. Scanning and transaction building
            happen entirely{" "}
            <strong className="text-[var(--foreground)]">in your browser</strong>
            , talking directly to Solana over RPC. There is no backend that can
            see your keys or move funds, no database, and no user accounts. Our
            only server code is a read-only endpoint that lists recent claims
            from public on-chain data.
          </p>
        </section>

        <section className="pixel-panel p-5">
          <h2 className="font-pixel text-[11px] text-[var(--accent)]">
            WHY FUNDS CAN&apos;T BE TAKEN
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong className="text-[var(--foreground)]">
                Keys never leave your wallet.
              </strong>{" "}
              Official Solana wallet adapter only. No seed phrase / private key
              input — ever.
            </li>
            <li>
              <strong className="text-[var(--foreground)]">
                Zero-balance only — enforced by Solana.
              </strong>{" "}
              The Token Program&apos;s CloseAccount instruction rejects any
              account that still holds tokens (
              <a
                className="text-[var(--accent)] underline"
                href="https://solana.com/docs/tokens/basics/close-account"
                target="_blank"
                rel="noopener noreferrer"
              >
                docs
              </a>
              ).
            </li>
            <li>
              <strong className="text-[var(--foreground)]">
                Rent refunds go to you.
              </strong>{" "}
              Each close names your wallet as the destination. SOL never passes
              through us.
            </li>
            <li>
              <strong className="text-[var(--foreground)]">
                You sign every tx.
              </strong>{" "}
              We also simulate each transaction before your wallet is prompted.
              Your wallet shows the net SOL change before you approve.
            </li>
          </ul>
        </section>

        <section className="pixel-panel p-5">
          <h2 className="font-pixel text-[11px] text-[var(--accent)]">
            THE FEE
          </h2>
          <p className="mt-3">
            We keep <strong className="text-[var(--foreground)]">{FEE_PERCENT}%</strong>{" "}
            of reclaimed rent as a SystemProgram.transfer inside the same
            atomic transaction. Fee is capped so it can never exceed reclaimed
            rent. You never pay out of pocket.
          </p>
          {FEE_WALLET_ADDRESS && (
            <p className="mt-3">
              Fee wallet:{" "}
              <a
                className="break-all font-mono text-base text-[var(--accent)] underline"
                href={SOLSCAN_ACCOUNT(FEE_WALLET_ADDRESS)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {FEE_WALLET_ADDRESS}
              </a>
            </p>
          )}
        </section>

        <section className="pixel-panel p-5">
          <h2 className="font-pixel text-[11px] text-[var(--accent)]">
            LIBRARIES
          </h2>
          <p className="mt-3">
            Only canonical Solana libs: @solana/web3.js, @solana/spl-token,
            @solana/wallet-adapter. No third-party analytics or tracking
            scripts.
          </p>
        </section>

        <section className="pixel-panel p-5">
          <h2 className="font-pixel text-[11px] text-[var(--accent)]">
            VERIFY YOURSELF
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>Confirm you are on https://mysolclaim.com</li>
            <li>
              Before signing: wallet simulation should show only account closes,
              a positive SOL change for you, and one small transfer to our fee
              wallet.
            </li>
            <li>
              After claiming: open the tx on Solscan and confirm refunds went to
              your address.
            </li>
            <li>
              Inspect our fee wallet history anytime — it is the complete
              public record of every fee earned.
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}
