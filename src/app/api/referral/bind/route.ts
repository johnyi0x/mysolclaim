import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { FEE_WALLET_ADDRESS } from "@/lib/constants";
import { parseReferrerParam } from "@/lib/referral";
import {
  bindReferralOnce,
  getReferralBinding,
  isReferralStoreConfigured,
} from "@/lib/referral-store";
import {
  clientKey,
  isAllowedOrigin,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Soft limits — bind is cheap but still spam-prone. */
const IP_LIMIT = 30;
const WALLET_LIMIT = 10;
const WINDOW_MS = 60_000;

function bad(status: number, error: string, headers?: HeadersInit) {
  return NextResponse.json({ error }, { status, headers });
}

/**
 * POST { claimant, referrer? }
 * Permanently binds claimant → referrer (first wins). Returns effective referrer.
 * Without Upstash, validates and echoes referrer (client localStorage is source of truth).
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) {
    return bad(403, "Origin not allowed");
  }

  const ipLimited = rateLimit(clientKey(req, "ref-bind"), IP_LIMIT, WINDOW_MS);
  if (!ipLimited.ok) {
    return NextResponse.json(
      {
        error: "Too many referral requests. Slow down.",
        retryAfterSec: ipLimited.retryAfterSec,
      },
      { status: 429, headers: rateLimitHeaders(ipLimited, IP_LIMIT) }
    );
  }

  let body: { claimant?: string; referrer?: string };
  try {
    body = (await req.json()) as { claimant?: string; referrer?: string };
  } catch {
    return bad(400, "Invalid JSON", rateLimitHeaders(ipLimited, IP_LIMIT));
  }

  let claimant: PublicKey;
  try {
    claimant = new PublicKey((body.claimant ?? "").trim());
  } catch {
    return bad(400, "Invalid claimant wallet", rateLimitHeaders(ipLimited, IP_LIMIT));
  }

  const claimantStr = claimant.toBase58();
  const walletLimited = rateLimit(
    `ref-bind-wallet:${claimantStr}`,
    WALLET_LIMIT,
    WINDOW_MS
  );
  if (!walletLimited.ok) {
    return NextResponse.json(
      {
        error: "This wallet hit the referral bind limit. Wait a moment.",
        retryAfterSec: walletLimited.retryAfterSec,
      },
      { status: 429, headers: rateLimitHeaders(walletLimited, WALLET_LIMIT) }
    );
  }

  // Existing binding always wins (anti-hijack).
  const existing = await getReferralBinding(claimantStr);
  if (existing) {
    return NextResponse.json(
      {
        referrer: existing,
        created: false,
        durable: isReferralStoreConfigured(),
      },
      { headers: rateLimitHeaders(ipLimited, IP_LIMIT) }
    );
  }

  const proposed = parseReferrerParam(body.referrer ?? null);
  if (!proposed) {
    return NextResponse.json(
      {
        referrer: null,
        created: false,
        durable: isReferralStoreConfigured(),
      },
      { headers: rateLimitHeaders(ipLimited, IP_LIMIT) }
    );
  }

  if (proposed === claimantStr) {
    return NextResponse.json(
      {
        referrer: null,
        created: false,
        reason: "self_referral",
        durable: isReferralStoreConfigured(),
      },
      { headers: rateLimitHeaders(ipLimited, IP_LIMIT) }
    );
  }

  if (FEE_WALLET_ADDRESS && proposed === FEE_WALLET_ADDRESS) {
    return NextResponse.json(
      {
        referrer: null,
        created: false,
        reason: "fee_wallet",
        durable: isReferralStoreConfigured(),
      },
      { headers: rateLimitHeaders(ipLimited, IP_LIMIT) }
    );
  }

  const { referrer, created } = await bindReferralOnce(claimantStr, proposed);

  return NextResponse.json(
    {
      referrer,
      created,
      durable: isReferralStoreConfigured(),
    },
    { headers: rateLimitHeaders(ipLimited, IP_LIMIT) }
  );
}

/** GET ?claimant= — look up binding only (no create). */
export async function GET(req: Request) {
  if (!isAllowedOrigin(req)) {
    return bad(403, "Origin not allowed");
  }

  const limited = rateLimit(clientKey(req, "ref-get"), 40, WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAfterSec: limited.retryAfterSec },
      { status: 429, headers: rateLimitHeaders(limited, 40) }
    );
  }

  const claimantRaw = new URL(req.url).searchParams.get("claimant")?.trim() ?? "";
  let claimant: PublicKey;
  try {
    claimant = new PublicKey(claimantRaw);
  } catch {
    return bad(400, "Invalid claimant", rateLimitHeaders(limited, 40));
  }

  const referrer = await getReferralBinding(claimant.toBase58());
  return NextResponse.json(
    {
      referrer,
      durable: isReferralStoreConfigured(),
    },
    { headers: rateLimitHeaders(limited, 40) }
  );
}
