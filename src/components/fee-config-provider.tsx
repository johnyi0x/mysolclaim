"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_FEE_PERCENT,
  DEFAULT_FEE_WALLET,
  DEFAULT_REFERRAL_SHARE_PERCENT,
  setClientFeeConfig,
  type FeeConfig,
} from "@/lib/fee-config";

const FALLBACK: FeeConfig = {
  feeWallet: DEFAULT_FEE_WALLET,
  feePercent: DEFAULT_FEE_PERCENT,
  referralSharePercent: DEFAULT_REFERRAL_SHARE_PERCENT,
};

const FeeConfigContext = createContext<FeeConfig>(FALLBACK);

export function useFeeConfig(): FeeConfig {
  return useContext(FeeConfigContext);
}

export function FeeConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<FeeConfig>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fee-config", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Partial<FeeConfig>;
        if (cancelled) return;
        const next: FeeConfig = {
          feeWallet: (data.feeWallet || FALLBACK.feeWallet).trim(),
          feePercent:
            typeof data.feePercent === "number"
              ? data.feePercent
              : FALLBACK.feePercent,
          referralSharePercent:
            typeof data.referralSharePercent === "number"
              ? data.referralSharePercent
              : FALLBACK.referralSharePercent,
        };
        setClientFeeConfig(next);
        setConfig(next);
      } catch {
        // keep fallback — still tips DEFAULT_FEE_WALLET
        setClientFeeConfig(FALLBACK);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <FeeConfigContext.Provider value={config}>
      {children}
    </FeeConfigContext.Provider>
  );
}
