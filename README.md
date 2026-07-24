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
| `HELIUS_RPC_URL` | optional fallback | Private RPC URL+key (server-only; used only if public fails) |

**RPC order:** public Solana RPC first → `HELIUS_RPC_URL` only if public fails.

**~230 claims/day:** usually fine on public RPC alone (~few thousand RPC
calls/day vs ~100 req / 10s / IP official limit). Spikes and heavy ledger
parsing can still 429 — keep Helius as optional fallback.

## Anti-spam

- `/api/scan` — 8/min/IP + 6/min/wallet
- `/api/recent-claims` — 20/min/IP + edge cache
- `/api/rpc` — 60/min/IP, allow-listed methods only
- Client scan cooldown 8s; ledger poll gap 15s

## Brand assets

| File | Use |
| --- | --- |
| `public/piggy.png` | Site header + favicon PNG |
| `public/favicon.svg` | Browser favicon |
| `public/piggy-x.png` | **X/Twitter profile picture** (1024×1024) |

## Vercel Analytics

Code includes `<Analytics />`. Also enable it once in the dashboard:
**Project → Analytics → Enable**.

## Deploy

Push to GitHub → Vercel auto-deploys. Set env vars before expecting scans to work.
