# MySolClaim (mysolclaim.com)

Non-custodial Solana tool to close **empty SPL token accounts** (classic Token
Program + Token-2022) and reclaim rent deposits (~0.002 SOL per account).

Pixel / arcade / terminal UI. Brand: **mysolclaim** + pixel piggy bank.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS v4 · `@solana/web3.js` ·
`@solana/spl-token` · `@solana/wallet-adapter` · `next-themes`

## Local development

```bash
npm install
cp .env.example .env.local
# fill in FEE_WALLET + Helius RPC URLs
npm run dev
```

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_FEE_WALLET` | browser + server | Public fee wallet address |
| `NEXT_PUBLIC_FEE_PERCENT` | browser | Fee % of reclaimed rent (default 10, clamped 0–50) |
| `NEXT_PUBLIC_RPC_URL` | browser | `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY` |
| `HELIUS_RPC_URL` | server only | Same URL for `/api/recent-claims` |

### Helius URL (important)

Helius does **not** show a ready-made URL. Your API key **is** the secret.
Build the URL yourself:

```
https://mainnet.helius-rpc.com/?api-key=PASTE_YOUR_KEY_HERE
```

Click the eye icon next to your key (e.g. `reclaimer`) → copy → paste after
`api-key=`. Domain allowlists are not always available on Free; rotate the key
if it gets abused, and keep `HELIUS_RPC_URL` server-only for the ledger route.

## Deploy

GitHub → Vercel → set env vars → add custom domain `mysolclaim.com`.

## Security model (short)

- No backend ever sees keys or funds.
- Token Program rejects closing non-zero balances on-chain.
- Rent destination is always the user; fee is a separate transfer in the same tx.
- Fee % is clamped; fee is capped at reclaimed rent.
- Each claim batch is simulated before the wallet is prompted to sign.
- Security headers (CSP, X-Frame-Options DENY, etc.) in `next.config.ts`.
