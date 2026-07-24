/**
 * Best-effort in-memory sliding-window rate limiter for serverless.
 * Each Vercel isolate keeps its own map — still stops rapid spam loops
 * and casual abuse without needing Redis for v1.
 */

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((windowMs - (now - oldest)) / 1000)
    );
    buckets.set(key, bucket);
    return { ok: false, remaining: 0, retryAfterSec };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);

  // Soft GC so the map doesn't grow forever on long-lived instances.
  if (buckets.size > 5_000) {
    for (const [k, b] of buckets) {
      b.timestamps = b.timestamps.filter((t) => now - t < windowMs);
      if (b.timestamps.length === 0) buckets.delete(k);
    }
  }

  return {
    ok: true,
    remaining: Math.max(0, limit - bucket.timestamps.length),
    retryAfterSec: 0,
  };
}

/** Extract a stable client key from a Request (IP + UA fingerprint). */
export function clientKey(req: Request, prefix: string): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip =
    (fwd ? fwd.split(",")[0]?.trim() : null) ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const ua = (req.headers.get("user-agent") || "ua").slice(0, 48);
  return `${prefix}:${ip}:${ua}`;
}

export function rateLimitHeaders(result: RateLimitResult, limit: number) {
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(result.remaining),
    ...(result.ok
      ? {}
      : { "Retry-After": String(result.retryAfterSec) }),
  };
}
