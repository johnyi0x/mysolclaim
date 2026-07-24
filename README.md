# MySolClaim (mysolclaim.com)

Non-custodial Solana tool to close **empty SPL token accounts** and reclaim rent.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS v3 · `@solana/web3.js` ·
`@solana/spl-token` · `@solana/wallet-adapter` · `next-themes` ·
`@vercel/analytics`

## Environment variables (Vercel)

| Name | Public? | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_FEE_WALLET` | yes (address only) | Fee wallet public address |
| `NEXT_PUBLIC_FEE_PERCENT` | yes | Fee % (default 10) |
| `HELIUS_RPC_URL` | **NO — server only** | `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY` |

**Do not put your Helius key in any `NEXT_PUBLIC_*` variable.** Those are
embedded in the browser bundle and visible to every visitor.

The site uses a rate-limited `/api/rpc` proxy (method allow-list) so the
browser never sees the key. Scanning uses `/api/scan` (also server-side).

### If you already set `NEXT_PUBLIC_RPC_URL`

1. Delete `NEXT_PUBLIC_RPC_URL` from Vercel env vars.
2. Keep only `HELIUS_RPC_URL` with your Helius URL+key.
3. Redeploy.

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
