# MySolClaim (mysolclaim.com)

Non-custodial Solana tool to close **empty SPL token accounts** (classic Token
Program + Token-2022) and reclaim rent deposits (~0.002 SOL per account).

Pixel / arcade / terminal UI. Brand: **mysolclaim** + pixel piggy bank.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS v3 · `@solana/web3.js` ·
`@solana/spl-token` · `@solana/wallet-adapter` · `next-themes`

## Local development

```bash
npm install
cp .env.example .env.local
# fill in FEE_WALLET + Helius RPC URLs
npm run dev
```

## Environment variables (required on Vercel)

Set these in **Vercel → Project → Settings → Environment Variables**
(Production + Preview):

| Name | Example | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_FEE_WALLET` | your fee wallet public address | fresh wallet public key only |
| `NEXT_PUBLIC_FEE_PERCENT` | `10` | optional, defaults to 10 |
| `NEXT_PUBLIC_RPC_URL` | `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY` | needed for signing txs in browser |
| `HELIUS_RPC_URL` | same as above | used by `/api/scan` + `/api/recent-claims` (server-only) |

Without these, the site deploys but scanning/ledger won't work properly.

## Anti-spam

- `/api/scan` — 8 req/min/IP + 6/min/wallet, 429 + Retry-After
- `/api/recent-claims` — 20 req/min/IP, edge-cached 60s
- Client scan cooldown 8s; ledger poll gap 15s
- Heavy empty-account RPC is server-side (protects Helius credits)

## Deploy

GitHub → Vercel → set env vars → add custom domain `mysolclaim.com`.
After fixing deps, push to `main` to redeploy.

## Security model (short)

- No backend ever sees keys or funds.
- Token Program rejects closing non-zero balances on-chain.
- Rent destination is always the user; fee is a separate transfer in the same tx.
- Fee % is clamped; fee is capped at reclaimed rent.
- Each claim batch is simulated before the wallet is prompted to sign.
- Security headers (CSP, X-Frame-Options DENY, etc.) in `next.config.ts`.
