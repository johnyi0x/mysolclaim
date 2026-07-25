"use client";

import { ThemeProvider } from "next-themes";
import { ReferralCapture } from "./referral-capture";
import { WalletProviders } from "./wallet-providers";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <WalletProviders>
        <ReferralCapture />
        {children}
      </WalletProviders>
    </ThemeProvider>
  );
}
