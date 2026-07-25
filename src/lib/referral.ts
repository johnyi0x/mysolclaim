import { PublicKey } from "@solana/web3.js";
import {
  FEE_PERCENT,
  FEE_WALLET,
  FEE_WALLET_ADDRESS,
  REFERRAL_SHARE_PERCENT,
} from "./constants";

export { REFERRAL_SHARE_PERCENT };

/** Platform keeps this fraction of the service fee when a referral applies. */
export const PLATFORM_SHARE_PERCENT = 100 - REFERRAL_SHARE_PERCENT;

export const REF_STORAGE_KEY = "mysolclaim:ref";
export const REF_BOUND_KEY = "mysolclaim:ref-bound"; // claimant already bound locally

export function parseReferrerParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 32 || trimmed.length > 64) return null;
  try {
    const pk = new PublicKey(trimmed);
    const base58 = pk.toBase58();
    if (FEE_WALLET_ADDRESS && base58 === FEE_WALLET_ADDRESS) return null;
    return base58;
  } catch {
    return null;
  }
}

export function referralLinkFor(wallet: string, origin?: string): string {
  const base =
    origin ||
    (typeof window !== "undefined" ? window.location.origin : "https://mysolclaim.com");
  return `${base}/?ref=${wallet}`;
}

export function splitServiceFee(
  totalFeeLamports: number,
  withReferrer: boolean
): { platformLamports: number; referrerLamports: number } {
  if (!withReferrer || totalFeeLamports <= 0 || REFERRAL_SHARE_PERCENT <= 0) {
    return { platformLamports: totalFeeLamports, referrerLamports: 0 };
  }
  const referrerLamports = Math.floor(
    (totalFeeLamports * REFERRAL_SHARE_PERCENT) / 100
  );
  return {
    platformLamports: totalFeeLamports - referrerLamports,
    referrerLamports,
  };
}

/** Capture ?ref= into localStorage (first-write wins until cleared). */
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

/**
 * Resolve which referrer (if any) should receive a cut for this claimant.
 * Never self-referral; never fee wallet.
 */
export function resolveReferrerForClaim(claimant: PublicKey): PublicKey | null {
  const stored = getStoredReferrer();
  if (!stored) return null;
  try {
    const ref = new PublicKey(stored);
    if (ref.equals(claimant)) return null;
    if (FEE_WALLET && ref.equals(FEE_WALLET)) return null;
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
  const totalFeeSol = (reclaimedSol * FEE_PERCENT) / 100;
  const referrerSol = (totalFeeSol * REFERRAL_SHARE_PERCENT) / 100;
  const platformSol = totalFeeSol - referrerSol;
  return {
    feePercent: FEE_PERCENT,
    referralSharePercent: REFERRAL_SHARE_PERCENT,
    platformSharePercent: PLATFORM_SHARE_PERCENT,
    totalFeeSol,
    platformSol,
    referrerSol,
    userNetSol: reclaimedSol - totalFeeSol,
  };
}
