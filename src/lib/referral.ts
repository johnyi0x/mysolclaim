import { PublicKey } from "@solana/web3.js";
import {
  getFeePercent,
  getFeeWallet,
  getFeeWalletAddress,
  getReferralSharePercent,
} from "./fee-config";

/** @deprecated Prefer getReferralSharePercent() for live values. */
export const REFERRAL_SHARE_PERCENT = getReferralSharePercent();
export const PLATFORM_SHARE_PERCENT = 100 - REFERRAL_SHARE_PERCENT;

export { getReferralSharePercent };

export const REF_STORAGE_KEY = "mysolclaim:ref";
export const REF_BOUND_KEY = "mysolclaim:ref-bound";

export function parseReferrerParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 32 || trimmed.length > 64) return null;
  try {
    const pk = new PublicKey(trimmed);
    const base58 = pk.toBase58();
    const feeWallet = getFeeWalletAddress();
    if (feeWallet && base58 === feeWallet) return null;
    return base58;
  } catch {
    return null;
  }
}

export function referralLinkFor(wallet: string, origin?: string): string {
  const base =
    origin ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "https://mysolclaim.com");
  return `${base}/?ref=${wallet}`;
}

export function splitServiceFee(
  totalFeeLamports: number,
  withReferrer: boolean
): { platformLamports: number; referrerLamports: number } {
  const share = getReferralSharePercent();
  if (!withReferrer || totalFeeLamports <= 0 || share <= 0) {
    return { platformLamports: totalFeeLamports, referrerLamports: 0 };
  }
  const referrerLamports = Math.floor((totalFeeLamports * share) / 100);
  return {
    platformLamports: totalFeeLamports - referrerLamports,
    referrerLamports,
  };
}

export function captureRefFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const parsed = parseReferrerParam(params.get("ref"));
  if (!parsed) return getStoredReferrer();
  try {
    const existing = localStorage.getItem(REF_STORAGE_KEY);
    if (!existing) {
      localStorage.setItem(REF_STORAGE_KEY, parsed);
    }
  } catch {
    // private mode
  }
  return getStoredReferrer();
}

export function getStoredReferrer(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return parseReferrerParam(localStorage.getItem(REF_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearStoredReferrer() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(REF_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function resolveReferrerForClaim(claimant: PublicKey): PublicKey | null {
  const stored = getStoredReferrer();
  if (!stored) return null;
  try {
    const ref = new PublicKey(stored);
    if (ref.equals(claimant)) return null;
    const feePk = getFeeWallet();
    if (feePk && ref.equals(feePk)) return null;
    return ref;
  } catch {
    return null;
  }
}

export function feeSplitExample(reclaimedSol = 1): {
  feePercent: number;
  referralSharePercent: number;
  platformSharePercent: number;
  totalFeeSol: number;
  platformSol: number;
  referrerSol: number;
  userNetSol: number;
} {
  const feePercent = getFeePercent();
  const referralSharePercent = getReferralSharePercent();
  const totalFeeSol = (reclaimedSol * feePercent) / 100;
  const referrerSol = (totalFeeSol * referralSharePercent) / 100;
  const platformSol = totalFeeSol - referrerSol;
  return {
    feePercent,
    referralSharePercent,
    platformSharePercent: 100 - referralSharePercent,
    totalFeeSol,
    platformSol,
    referrerSol,
    userNetSol: reclaimedSol - totalFeeSol,
  };
}
