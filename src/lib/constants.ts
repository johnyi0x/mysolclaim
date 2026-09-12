import {
  getFeePercent,
  getFeeWallet,
  getFeeWalletAddress,
  getReferralSharePercent,
  readFeeConfigFromEnv,
} from "./fee-config";

/**
 * Fee settings — prefer server env `FEE_WALLET` / `FEE_PERCENT` (no NEXT_PUBLIC_).
 * Browser hydrates via /api/fee-config.
 * Legacy NEXT_PUBLIC_* still works until you rename vars in Vercel.
 */
export const FEE_WALLET_ADDRESS: string = getFeeWalletAddress();
export const FEE_WALLET = getFeeWallet();
export const FEE_PERCENT: number = getFeePercent();
export const REFERRAL_SHARE_PERCENT: number = getReferralSharePercent();

export {
  getFeePercent,
  getFeeWallet,
  getFeeWalletAddress,
  getReferralSharePercent,
  computeFeeLamports,
  readFeeConfigFromEnv,
} from "./fee-config";

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
export const X_URL = "https://x.com/JohnYi0x";
