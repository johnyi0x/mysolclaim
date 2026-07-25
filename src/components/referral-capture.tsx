"use client";

import { useEffect } from "react";
import { captureRefFromUrl } from "@/lib/referral";

/** Captures ?ref= on any page load (first-write wins in localStorage). */
export function ReferralCapture() {
  useEffect(() => {
    captureRefFromUrl();
  }, []);
  return null;
}
