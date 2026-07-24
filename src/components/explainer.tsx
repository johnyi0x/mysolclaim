export function Explainer() {
  return (
    <section className="border-y-[3px] border-[var(--panel-border)] bg-[var(--panel)] py-16">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 className="font-pixel text-sm sm:text-base">
            &gt; what_are_empty_accounts?
          </h2>
          <div className="mt-5 space-y-4 text-xl text-[var(--muted)]">
            <p>
              Every time you receive a token, memecoin or NFT on Solana, your
              wallet creates a dedicated <strong className="text-[var(--foreground)]">token account</strong>{" "}
              for it — and deposits about{" "}
              <strong className="text-[var(--accent)]">0.002 SOL</strong> as{" "}
              <em>rent</em> to keep that account on-chain.
            </p>
            <p>
              When you later sell or send the entire balance, the token account
              stays behind with zero tokens in it. It does nothing — but your
              rent deposit remains locked inside.
            </p>
            <p>
              Closing an empty account refunds the deposit straight back to
              your wallet. Active traders often have dozens of these without
              knowing it.
            </p>
            <p className="text-lg">
              Rent is an official Solana mechanism —{" "}
              <a
                href="https://solana.com/docs/core/fees#rent"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] underline underline-offset-2"
              >
                read the docs
              </a>
              .
            </p>
          </div>
        </div>

        <div className="pixel-panel p-6">
          <p className="font-pixel text-[10px] text-[var(--accent)]">
            EXAMPLE.LOG
          </p>
          <ul className="mt-4 space-y-4 text-lg">
            <li className="flex items-start gap-3">
              <span className="text-[var(--accent)]">[+]</span>
              <span>
                Bought a memecoin → wallet locked{" "}
                <strong>0.00204 SOL</strong> as rent.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-[var(--accent-2)]">[~]</span>
              <span>
                Sold everything → account holds <strong>0 tokens</strong>, rent
                still locked.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-[var(--accent)]">[$]</span>
              <span>
                Close here → deposit returns to your wallet (minus disclosed
                fee).
              </span>
            </li>
          </ul>
          <div className="mt-6 border-[3px] border-[var(--panel-border)] bg-[var(--background)] p-4 text-center">
            <p className="text-base uppercase text-[var(--muted)]">
              50 empty accounts ≈
            </p>
            <p className="font-pixel text-lg text-[var(--accent)]">0.102 SOL</p>
            <p className="text-base uppercase text-[var(--muted)]">
              reclaimable
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
