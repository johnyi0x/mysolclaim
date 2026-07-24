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
| `HELIUS_RPC_URL` | strongly recommended | Private RPC URL+key (server-only) |

**Helius is optional for demos.** Without it, the app falls back to Solana's
public RPC (`api.mainnet-beta.solana.com`) — that is why your wallet scan
worked with no env vars set. Public RPC is fine for light testing but will
rate-limit or fail under real traffic. For production, set `HELIUS_RPC_URL`
(server-only, never `NEXT_PUBLIC_*`).

**Never put an API key in `NEXT_PUBLIC_*`.** Those values are shipped to every
visitor's browser.

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
