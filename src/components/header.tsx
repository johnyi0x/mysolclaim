"use client";

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ThemeToggle } from "./theme-toggle";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (m) => m.WalletMultiButton
    ),
  { ssr: false }
);

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-[var(--panel-border)] bg-[var(--panel)]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/piggy.png"
            alt="MySolClaim piggy bank"
            width={36}
            height={36}
            className="h-9 w-9"
            style={{ imageRendering: "pixelated" }}
            priority
          />
          <span className="font-pixel text-[11px] leading-none sm:text-xs">
            mysolclaim
          </span>
        </Link>

        <nav className="hidden items-center gap-5 text-lg uppercase tracking-wide text-[var(--muted)] md:flex">
          <Link href="/#how-it-works" className="hover:text-[var(--accent)]">
            How it works
          </Link>
          <Link href="/security" className="hover:text-[var(--accent)]">
            Security
          </Link>
          <Link href="/faq" className="hover:text-[var(--accent)]">
            FAQ
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
