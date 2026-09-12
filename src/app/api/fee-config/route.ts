import { NextResponse } from "next/server";
import { readFeeConfigFromEnv } from "@/lib/fee-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public fee settings for the browser claim UI.
 * Values come from server env (FEE_WALLET / FEE_PERCENT) — not NEXT_PUBLIC_*.
 * The fee wallet address is intentionally public (receive-only).
 */
export async function GET() {
  const config = readFeeConfigFromEnv();
  return NextResponse.json(config, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
