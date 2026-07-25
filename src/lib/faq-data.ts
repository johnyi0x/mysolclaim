export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Is this safe? Can you steal my tokens or NFTs?",
    answer:
      "No. This tool can only close token accounts whose balance is exactly zero — and that rule is enforced by the Solana Token Program itself, on-chain, not by our code. A close on any account that still holds tokens is rejected by the network. We never ask for your seed phrase or private key, we never hold your funds, and nothing can happen until you review and sign a transaction in your own wallet.",
  },
  {
    question: "Where does the reclaimed SOL come from?",
    answer:
      "Every time you receive a new token, your wallet creates a token account for it and deposits about 0.002 SOL as 'rent' to keep that account on-chain. When you later sell or send the full balance, the account sits empty — but the deposit stays locked inside it. Closing the empty account refunds that deposit straight back to your wallet.",
  },
  {
    question: "What is the fee and how is it taken?",
    answer:
      "We keep a small percentage of the reclaimed rent (shown before you sign). The fee is a simple transfer inside the same transaction that closes your accounts, so it is atomic: either you receive your SOL and we receive the fee, or nothing happens at all. You never pay out of pocket, and you can verify every fee our wallet has ever received on Solscan — the address is in the footer. If you arrived via a referral link, that same fee is split on-chain between the platform and the referrer — you still pay the same total percentage.",
  },
  {
    question: "How does the referral program work?",
    answer:
      "Connect on the Referral page to get a link like mysolclaim.com/?ref=YOUR_WALLET. When someone claims after using your link, they still pay the normal service fee; a fixed share of that fee (default 30%, so a 70/30 split with the platform) is tipped to your wallet in the same transaction. Keep about 0.001 SOL in your wallet so Solana can land those tips. Details and your cumulative on-chain earnings are on /referral.",
  },
  {
    question: "Which wallets are supported?",
    answer:
      "Any wallet that supports the Solana Wallet Standard: Phantom, Solflare, Backpack, and most others. On mobile, open this site inside your wallet's built-in browser.",
  },
  {
    question: "Why does my wallet ask me to sign more than one transaction?",
    answer:
      "A single Solana transaction has a size limit that fits roughly 20 account closes. If you selected more accounts than that, we split the claim into several transactions and your wallet asks you to approve each one. Each transaction is independent and shows you its exact effect before signing.",
  },
  {
    question: "What exactly do I see before signing?",
    answer:
      "Your wallet simulates every transaction before you approve it. Phantom, Solflare and Backpack all display the net SOL you will receive. If a transaction would do anything other than close your empty accounts and pay the disclosed fee, the simulation would show it.",
  },
  {
    question: "What is Token-2022?",
    answer:
      "Token-2022 (Token Extensions) is the newer Solana token program. Empty Token-2022 accounts also hold a rent deposit and can be closed the same way. The rare Token-2022 account with withheld transfer fees can't be closed yet — we show those greyed out with the reason instead of hiding them.",
  },
  {
    question: "Will this affect the tokens I still hold?",
    answer:
      "No. Accounts that hold any token balance are never shown for selection, and even if one were selected by mistake, the network itself would reject closing it. Closing an empty account also doesn't stop you from receiving that token again later — a new account is simply created if you do (with a new rent deposit, as always).",
  },
  {
    question: "How many empty accounts might I have?",
    answer:
      "Every token, memecoin or NFT you ever received created one. Active traders often have dozens — sometimes hundreds — of empty accounts, each holding about 0.002 SOL. The scan is free and read-only, so it costs nothing to check.",
  },
  {
    question: "Do you have a backend that touches my wallet?",
    answer:
      "No. Scanning and transaction building happen entirely in your browser, talking directly to the Solana blockchain. Our only server code is a read-only endpoint that lists recent claims from public on-chain data. There is no database, no accounts, and nothing to hack that could ever move your funds.",
  },
];
