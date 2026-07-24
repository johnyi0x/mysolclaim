"use client";

import { ThemeProvider } from "next-themes";
import { WalletProviders } from "./wallet-providers";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <WalletProviders>{children}</WalletProviders>
    </ThemeProvider>
  );
}
