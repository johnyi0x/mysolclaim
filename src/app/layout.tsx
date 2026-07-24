import type { Metadata } from "next";
import { Press_Start_2P, VT323 } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

const pressStart = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-press-start",
  display: "swap",
});

const vt323 = VT323({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-vt323",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MySolClaim — reclaim SOL locked in empty token accounts",
  description:
    "Non-custodial Solana tool to close empty token accounts and reclaim rent (~0.002 SOL each). Your keys never leave your wallet. You sign every transaction.",
  keywords: [
    "solana",
    "mysolclaim",
    "claim sol",
    "empty token accounts",
    "close token accounts",
    "reclaim rent",
    "non-custodial",
  ],
  metadataBase: new URL("https://mysolclaim.com"),
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/piggy.png" }],
    apple: "/piggy.png",
  },
  openGraph: {
    title: "MySolClaim",
    description:
      "Close empty Solana token accounts and reclaim your locked rent. Non-custodial.",
    url: "https://mysolclaim.com",
    siteName: "MySolClaim",
    images: [{ url: "/piggy.png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${pressStart.variable} ${vt323.variable} min-h-screen antialiased`}
      >
        <Providers>
          <Header />
          <main>{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
