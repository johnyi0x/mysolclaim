import Image from "next/image";
import Link from "next/link";
import { FEE_WALLET_ADDRESS, SOLSCAN_ACCOUNT, X_URL } from "@/lib/constants";
import { truncateAddress } from "@/lib/format";
import { XLinkButton } from "./x-link";

export function Footer() {
  return (
    <footer className="border-t-[3px] border-[var(--panel-border)] bg-[var(--panel)]">
      <div className="mx-auto max-w-6xl px-3 py-8 sm:px-4 sm:py-10">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-3">
              <Image
                src="/piggy.png"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 bg-transparent"
                style={{ imageRendering: "pixelated" }}
                unoptimized
              />
              <p className="font-pixel text-[10px] sm:text-xs">mysolclaim</p>
              <XLinkButton size="sm" className="ml-1" />
            </div>
            <p className="mt-3 text-base text-[var(--muted)] sm:text-lg">
              Non-custodial tool to reclaim SOL locked in empty token accounts.
              Your keys never leave your wallet. You sign every transaction.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 text-base sm:text-lg md:flex md:gap-16">
            <div>
              <p className="mb-3 font-pixel text-[10px] text-[var(--accent)]">
                SITE
              </p>
              <ul className="space-y-2 text-[var(--muted)]">
                <li>
                  <Link
                    className="hover:text-[var(--accent)]"
                    href="/#how-it-works"
                  >
                    How it works
                  </Link>
                </li>
                <li>
                  <Link className="hover:text-[var(--accent)]" href="/referral">
                    Referral
                  </Link>
                </li>
                <li>
                  <Link className="hover:text-[var(--accent)]" href="/security">
                    Security
                  </Link>
                </li>
                <li>
                  <Link className="hover:text-[var(--accent)]" href="/faq">
                    FAQ
                  </Link>
                </li>
                <li>
                  <Link className="hover:text-[var(--accent)]" href="/terms">
                    Terms
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="mb-3 font-pixel text-[10px] text-[var(--accent)]">
                PROOF
              </p>
              <ul className="space-y-2 text-[var(--muted)]">
                <li>
                  <a
                    href={X_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[var(--accent)]"
                  >
                    X / @mysolclaim ↗
                  </a>
                </li>
                <li>
                  {FEE_WALLET_ADDRESS ? (
                    <a
                      href={SOLSCAN_ACCOUNT(FEE_WALLET_ADDRESS)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-[var(--accent)]"
                    >
                      Fee wallet: {truncateAddress(FEE_WALLET_ADDRESS, 5)} ↗
                    </a>
                  ) : (
                    <span>Fee wallet: not configured</span>
                  )}
                </li>
                <li>
                  <a
                    href="https://solana.com/docs/tokens/basics/close-account"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[var(--accent)]"
                  >
                    Solana docs ↗
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <p className="mt-10 text-base text-[var(--muted)]">
          © {new Date().getFullYear()} MySolClaim · mysolclaim.com · provided
          as-is. All actions require your explicit wallet signature.
        </p>
      </div>
    </footer>
  );
}
