# MySolClaim (mysolclaim.com)

Non-custodial Solana tool to close **empty SPL token accounts** and reclaim rent.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS v3 · `@solana/web3.js` ·
`@solana/spl-token` · `@solana/wallet-adapter` · `next-themes` ·
`@vercel/analytics`

## Environment variables (Vercel)

Use normal **Config** vars (no `NEXT_PUBLIC_` prefix). The browser loads fee
settings from `GET /api/fee-config`.

| Name | Required? | Purpose |
| --- | --- | --- |
| `FEE_WALLET` | yes | Fee wallet public address (receive-only) |
| `FEE_PERCENT` | no (default 5) | Fee % of reclaimed SOL |
| `REFERRAL_SHARE_PERCENT` | no (default 30) | Referrer cut of the service fee |
| `NEON_CONNECTION_STRING` | yes for accurate stats | Neon Postgres URL (server-only) |
| `HELIUS_RPC_URL` | optional fallback | Private RPC URL+key (server-only) |
| `UPSTASH_REDIS_REST_URL` / `TOKEN` | optional | Durable referral bind across devices |

Legacy `NEXT_PUBLIC_FEE_*` names still work until you rename them.
If `FEE_WALLET` is missing, the app falls back to the known public fee address.

**RPC order:** public Solana RPC first → `HELIUS_RPC_URL` only if public fails.
JSON-RPC **batches are never sent** (free Helius compatible).

**Ledger / stats:** With `NEON_CONNECTION_STRING`, `/api/recent-claims` seeds
fee-wallet history into Neon once, then incrementally inserts only new claims.
All-time users/SOL/claims persist forever; 24h is queried from stored rows.
Without Neon, the API falls back to a short RPC window (stats can shrink).

**Security:** `NEON_CONNECTION_STRING` must never be `NEXT_PUBLIC_*`. Clients
cannot write stats — only server sync from on-chain fee-wallet txs (rate-limited).

## Anti-spam

- `/api/scan` — 8/min/IP + 6/min/wallet
- `/api/recent-claims` — 20/min/IP + edge cache
- `/api/rpc` — 60/min/IP, allow-listed methods only
- Client scan cooldown 8s; ledger poll gap 15s

## Brand assets

| File | Use |
| --- | --- |
| `public/piggy.png` | Site header logo (transparent background) |
| `public/favicon.png` / `favicon.ico` | Browser favicon (from logo) |
| `public/piggy-x.png` | **X/Twitter profile picture** (navy background) |

## Vercel Analytics

Code includes `<Analytics />`. Also enable it once in the dashboard:
**Project → Analytics → Enable**.

## Deploy

Push to GitHub → Vercel auto-deploys. Set env vars before expecting scans to work.
