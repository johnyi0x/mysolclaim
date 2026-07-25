/**
 * Client helper: resolve the referrer for a claim (bind + localStorage).
 * Server binding (Upstash) wins when configured; otherwise localStorage.
 */
import { PublicKey } from "@solana/web3.js";
import {
  getStoredReferrer,
  parseReferrerParam,
  resolveReferrerForClaim,
} from "./referral";

export async function fetchEffectiveReferrer(
  claimant: PublicKey
): Promise<PublicKey | null> {
  const stored = getStoredReferrer();

  try {
    const res = await fetch("/api/referral/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimant: claimant.toBase58(),
        referrer: stored ?? undefined,
      }),
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { referrer?: string | null };
      const parsed = parseReferrerParam(data.referrer ?? null);
      if (parsed && parsed !== claimant.toBase58()) {
        return new PublicKey(parsed);
      }
      // Server said null (self-ref / none) — respect that over local only when durable bind existed
      if (data.referrer === null && !stored) return null;
    }
  } catch {
    // fall through to local
  }

  return resolveReferrerForClaim(claimant);
}
