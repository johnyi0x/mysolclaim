const STEPS = [
  {
    n: "01",
    title: "CONNECT",
    text: "Connect Phantom, Solflare, Backpack or any Solana wallet. Connecting is read-only — it only shares your public address.",
  },
  {
    n: "02",
    title: "SCAN",
    text: "We scan the blockchain for token accounts you own with a balance of exactly zero. Free, instant, and nothing is signed.",
  },
  {
    n: "03",
    title: "REVIEW",
    text: "See every empty account and the rent locked in it. Select all or pick individually — exact SOL shown before anything happens.",
  },
  {
    n: "04",
    title: "CLAIM",
    text: "Your wallet simulates the transaction and shows the net SOL you gain. Approve it, and the rent lands directly in your wallet.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-3 py-12 sm:px-4 sm:py-16">
      <h2 className="text-center font-pixel text-[11px] sm:text-sm sm:text-base">
        &gt; how_it_works
      </h2>
      <p className="mx-auto mt-3 max-w-xl px-2 text-center text-lg text-[var(--muted)] sm:text-xl">
        Four steps. Nothing moves without your signature.
      </p>
      <div className="mt-8 grid gap-4 sm:mt-10 sm:gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step) => (
          <div key={step.n} className="pixel-panel p-5">
            <span className="font-pixel text-[10px] text-[var(--accent)]">
              {step.n}
            </span>
            <h3 className="mt-3 font-pixel text-[11px]">{step.title}</h3>
            <p className="mt-3 text-lg leading-snug text-[var(--muted)]">
              {step.text}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
