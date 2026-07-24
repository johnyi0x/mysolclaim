"use client";

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { getBrowserRpcEndpoint } from "@/lib/rpc-endpoint";

import "@solana/wallet-adapter-react-ui/styles.css";

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [], []);
  // Same-origin /api/rpc proxy — Helius key never reaches the browser.
  const endpoint = useMemo(() => getBrowserRpcEndpoint(), []);

  // HTTP-only proxy — do NOT derive wss://…/api/rpc (it does not exist and
  // makes confirmTransaction hang). Confirmation uses HTTP polling instead.
  return (
    <ConnectionProvider
      endpoint={endpoint}
      config={{
        commitment: "confirmed",
        wsEndpoint: "wss://api.mainnet-beta.solana.com",
      }}
    >
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
