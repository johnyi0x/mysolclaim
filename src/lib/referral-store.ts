/**
 * Optional durable claimant→referrer binding via Upstash Redis REST.
 * Without env vars, binding is localStorage-only (still works for same browser).
 */

const BIND_PREFIX = "mysolclaim:bind:";

function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  );
}

async function upstash(
  command: (string | number)[]
): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL!.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!.trim();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Upstash ${res.status}`);
  }
  const json = (await res.json()) as { result?: unknown };
  return json.result;
}

/** Returns existing binding, or null. */
export async function getReferralBinding(
  claimantWallet: string
): Promise<string | null> {
  if (!upstashConfigured()) return null;
  try {
    const result = await upstash(["GET", `${BIND_PREFIX}${claimantWallet}`]);
    return typeof result === "string" && result.length > 0 ? result : null;
  } catch (err) {
    console.error("referral bind get failed:", err);
    return null;
  }
}

/**
 * Bind claimant → referrer once (NX). Returns the effective referrer
 * (existing binding wins).
 */
export async function bindReferralOnce(
  claimantWallet: string,
  referrerWallet: string
): Promise<{ referrer: string; created: boolean }> {
  if (!upstashConfigured()) {
    return { referrer: referrerWallet, created: false };
  }
  try {
    const existing = await getReferralBinding(claimantWallet);
    if (existing) {
      return { referrer: existing, created: false };
    }
    // SET key value NX — only if not exists
    const setResult = await upstash([
      "SET",
      `${BIND_PREFIX}${claimantWallet}`,
      referrerWallet,
      "NX",
    ]);
    if (setResult === "OK") {
      return { referrer: referrerWallet, created: true };
    }
    const again = await getReferralBinding(claimantWallet);
    return { referrer: again || referrerWallet, created: false };
  } catch (err) {
    console.error("referral bind set failed:", err);
    return { referrer: referrerWallet, created: false };
  }
}

export function isReferralStoreConfigured(): boolean {
  return upstashConfigured();
}
