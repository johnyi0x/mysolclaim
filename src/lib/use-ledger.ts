"use client";

import { useCallback, useEffect, useState } from "react";
import type { LedgerResponse } from "@/app/api/recent-claims/route";

export const CLAIMS_UPDATED_EVENT = "solreclaim:claims-updated";

/** Tell every ledger consumer (hero stats, claims table) to refetch. */
export function notifyClaimsUpdated() {
  window.dispatchEvent(new Event(CLAIMS_UPDATED_EVENT));
}

export function useLedger() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // Bypass the edge cache when refreshing right after a claim.
      const res = await fetch("/api/recent-claims", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      // Ledger is decorative; fail silently.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUpdate = () => {
      // Give the RPC a moment to index the just-confirmed transaction.
      setTimeout(refresh, 4000);
    };
    window.addEventListener(CLAIMS_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(CLAIMS_UPDATED_EVENT, onUpdate);
  }, [refresh]);

  return { data, loading, refresh };
}
