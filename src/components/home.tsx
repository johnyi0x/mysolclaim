"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Dashboard } from "./dashboard";
import { Explainer } from "./explainer";
import { FaqSection } from "./faq";
import { Hero } from "./hero";
import { HowItWorks } from "./how-it-works";
import { LatestClaims } from "./latest-claims";
import { Trust } from "./trust";

export function Home() {
  const { publicKey } = useWallet();

  return (
    <>
      {publicKey ? (
        <Dashboard />
      ) : (
        <>
          <Hero />
          <HowItWorks />
          <Explainer />
          <Trust />
        </>
      )}
      <LatestClaims />
      <FaqSection />
    </>
  );
}
