"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LedgerResponse } from "@/app/api/recent-claims/route";

export const CLAIMS_UPDATED_EVENT = "solreclaim:claims-updated";

export function notifyClaimsUpdated() {
  window.dispatchEvent(new Event(CLAIMS_UPDATED_EVENT));
}

/** Min gap between ledger polls (anti-spam). */
const MIN_POLL_GAP_MS = 15_000;

export function useLedger() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const lastFetch = useRef(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async (force = false, syncChain = false) => {
    const now = Date.now();
    if (inFlight.current) return;
    if (!force && now - lastFetch.current < MIN_POLL_GAP_MS && data) return;

    inFlight.current = true;
    try {
      // syncChain=true only after a successful claim — forces Neon incremental ingest.
      const url = syncChain
        ? "/api/recent-claims?sync=1"
        : "/api/recent-claims";
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 429) {
        // Back off quietly — keep last good data.
        return;
      }
      if (res.ok) {
        setData(await res.json());
        lastFetch.current = Date.now();
      }
    } catch {
      // Ledger is decorative; fail silently.
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    refresh(true, false);
    const onUpdate = () => {
      setTimeout(() => refresh(true, true), 4000);
    };
    window.addEventListener(CLAIMS_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(CLAIMS_UPDATED_EVENT, onUpdate);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount once

  return { data, loading, refresh };
}
