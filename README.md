# MySolClaim (mysolclaim.com)

Non-custodial Solana tool to close **empty SPL token accounts** and reclaim rent.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS v3 · `@solana/web3.js` ·
`@solana/spl-token` · `@solana/wallet-adapter` · `next-themes` ·
`@vercel/analytics`

## Environment variables (Vercel)

| Name | Required? | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_FEE_WALLET` | yes | Fee wallet public address |
| `NEXT_PUBLIC_FEE_PERCENT` | no (default 10) | Fee % |
| `NEXT_PUBLIC_REFERRAL_SHARE_PERCENT` | no (default 30) | Referrer cut of the service fee |
| `NEON_CONNECTION_STRING` | yes for accurate stats | Neon Postgres URL (server-only) — durable all-time + 24h stats |
| `HELIUS_RPC_URL` | optional fallback | Private RPC URL+key (server-only; used only if public fails) |
| `UPSTASH_REDIS_REST_URL` / `TOKEN` | optional | Durable referral bind across devices |

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
