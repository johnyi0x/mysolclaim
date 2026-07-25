import { PublicKey } from "@solana/web3.js";

/** Public address of the fee wallet. Every claim tx sends the fee here. */
export const FEE_WALLET_ADDRESS = process.env.NEXT_PUBLIC_FEE_WALLET ?? "";

export const FEE_WALLET: PublicKey | null = (() => {
  try {
    return FEE_WALLET_ADDRESS ? new PublicKey(FEE_WALLET_ADDRESS) : null;
  } catch {
    return null;
  }
})();

/**
 * Percentage of reclaimed rent taken as the service fee (e.g. 10 = 10%).
 * Clamped to 0–50 so a bad env value can never take more than half.
 */
export const FEE_PERCENT = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_FEE_PERCENT ?? "10");
  if (!Number.isFinite(raw)) return 10;
  return Math.min(50, Math.max(0, Math.floor(raw)));
})();

/** Max CloseAccount instructions per transaction (size limit is ~1232 bytes). */
export const CLOSES_PER_TX = 20;

/** Rent-exempt deposit of a standard token account, for display estimates. */
export const RENT_PER_ACCOUNT_SOL = 0.00203928;

/** Max rows returned by /api/recent-claims for the live feed. */
export const LEDGER_DISPLAY_LIMIT = 12;

/** Client-side mobile feed cap (desktop shows full LEDGER_DISPLAY_LIMIT). */
export const LEDGER_MOBILE_LIMIT = 8;

/**
 * Max fee-wallet signatures to pull for stats + feed.
 * Kept small so public RPC stays under rate limits (efficiency > completeness).
 */
export const LEDGER_HISTORY_CAP = 40;

/** How many of those signatures we fully parse into claim rows. */
export const LEDGER_PARSE_LIMIT = 24;

export const SOLSCAN_TX = (sig: string) => `https://solscan.io/tx/${sig}`;
export const SOLSCAN_ACCOUNT = (addr: string) =>
  `https://solscan.io/account/${addr}`;

/** Official X / Twitter account. */
export const X_URL = "https://x.com/mysolclaim";

/**
 * Percent of the *service fee* paid to a referrer (rest stays with platform).
 * Example: FEE_PERCENT=10 and this=20 → user pays 10% fee; referrer gets 2% of
 * reclaimed SOL, platform keeps 8%. Scales automatically if FEE_PERCENT changes.
 */
export const REFERRAL_SHARE_PERCENT = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_REFERRAL_SHARE_PERCENT ?? "20");
  if (!Number.isFinite(raw)) return 20;
  return Math.min(50, Math.max(0, Math.floor(raw)));
})();
