import { PublicKey } from "@solana/web3.js";

/**
 * Server-only fee settings (Vercel "Config" / plain env — no NEXT_PUBLIC_ needed).
 * Browser gets these via GET /api/fee-config (address + % are intentionally public).
 *
 * Prefer: FEE_WALLET, FEE_PERCENT, REFERRAL_SHARE_PERCENT
 * Legacy NEXT_PUBLIC_* still accepted so old deploys keep working until you rename.
 */
export const DEFAULT_FEE_WALLET =
  "3h9pzHY4NitMBHWV8Djgm8bobmYWLYRk1oYUKPqf5fHF";

export const DEFAULT_FEE_PERCENT = 5;
export const DEFAULT_REFERRAL_SHARE_PERCENT = 30;

export interface FeeConfig {
  feeWallet: string;
  feePercent: number;
  referralSharePercent: number;
}

function clampPercent(raw: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(50, Math.max(0, Math.floor(raw)));
}

function firstEnv(...keys: string[]): string {
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }
  return "";
}

/** Read fee settings from process.env (server / Node only). */
export function readFeeConfigFromEnv(): FeeConfig {
  const feeWallet =
    firstEnv("FEE_WALLET", "NEXT_PUBLIC_FEE_WALLET") || DEFAULT_FEE_WALLET;

  const feePercent = clampPercent(
    Number(firstEnv("FEE_PERCENT", "NEXT_PUBLIC_FEE_PERCENT") || String(DEFAULT_FEE_PERCENT)),
    DEFAULT_FEE_PERCENT
  );

  const referralSharePercent = clampPercent(
    Number(
      firstEnv("REFERRAL_SHARE_PERCENT", "NEXT_PUBLIC_REFERRAL_SHARE_PERCENT") ||
        String(DEFAULT_REFERRAL_SHARE_PERCENT)
    ),
    DEFAULT_REFERRAL_SHARE_PERCENT
  );

  return { feeWallet, feePercent, referralSharePercent };
}

export function parseFeeWallet(address: string): PublicKey | null {
  const raw = address.trim();
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

/* ——— Client runtime (filled by FeeConfigProvider from /api/fee-config) ——— */

let clientConfig: FeeConfig | null = null;

export function setClientFeeConfig(config: FeeConfig) {
  clientConfig = config;
}

export function getClientFeeConfig(): FeeConfig | null {
  return clientConfig;
}

/**
 * Fee settings for claim builders / client UI.
 * Uses hydrated client config when available; otherwise env (SSR / first paint).
 */
export function getFeeConfig(): FeeConfig {
  if (typeof window !== "undefined" && clientConfig) {
    return clientConfig;
  }
  return readFeeConfigFromEnv();
}

export function getFeePercent(): number {
  return getFeeConfig().feePercent;
}

export function getFeeWalletAddress(): string {
  return getFeeConfig().feeWallet;
}

export function getFeeWallet(): PublicKey | null {
  return parseFeeWallet(getFeeWalletAddress());
}

export function getReferralSharePercent(): number {
  return getFeeConfig().referralSharePercent;
}

export function computeFeeLamports(
  reclaimableLamports: number,
  feePercent = getFeePercent()
): number {
  return Math.floor((reclaimableLamports * feePercent) / 100);
}
