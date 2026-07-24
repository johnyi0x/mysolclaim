"use client";

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { ThemeToggle } from "./theme-toggle";
import { XLinkButton } from "./x-link";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (m) => m.WalletMultiButton
    ),
  { ssr: false }
);

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-[var(--panel-border)] bg-[var(--panel)]/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:min-h-16 sm:gap-3 sm:px-4">
        <Link
          href="/"
          className="flex min-w-0 shrink items-center gap-3 sm:gap-3.5"
        >
          <Image
            src="/piggy.png"
            alt="MySolClaim piggy bank"
            width={36}
            height={36}
            className="h-8 w-8 shrink-0 bg-transparent sm:h-9 sm:w-9"
            style={{ imageRendering: "pixelated" }}
            priority
            unoptimized
          />
          <span className="font-pixel truncate text-[9px] leading-none sm:text-[11px] md:text-xs">
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

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            aria-label="Open menu"
            className="pixel-btn pixel-btn-secondary flex h-10 w-10 items-center justify-center md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? "X" : "≡"}
          </button>
          <ThemeToggle />
          <XLinkButton />
          <div className="wallet-btn-wrap">
            <WalletMultiButton />
          </div>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t-[3px] border-[var(--panel-border)] bg-[var(--panel)] px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1 text-lg uppercase text-[var(--muted)]">
            {[
              { href: "/#how-it-works", label: "How it works" },
              { href: "/security", label: "Security" },
              { href: "/faq", label: "FAQ" },
              { href: "/terms", label: "Terms" },
              { href: "https://x.com/mysolclaim", label: "X / Twitter ↗", external: true },
            ].map((item) =>
              "external" in item && item.external ? (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-11 py-2 hover:text-[var(--accent)]"
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </a>
              ) : (
              <Link
                key={item.href}
                href={item.href}
                className="min-h-11 py-2 hover:text-[var(--accent)]"
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
              )
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
