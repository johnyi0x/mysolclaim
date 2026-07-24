import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

/** Format lamports as a SOL string, trimming trailing zeros. */
export function formatSol(lamports: number, maxDecimals = 5): string {
  const sol = lamportsToSol(lamports);
  if (sol === 0) return "0";
  if (sol < 1 / 10 ** maxDecimals) return `<0.${"0".repeat(maxDecimals - 1)}1`;
  return sol.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function timeAgo(unixSeconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
