/**
 * Browser Connection uses our same-origin RPC proxy so the Helius API key
 * never ships in the client bundle. HELIUS_RPC_URL stays server-only.
 */
export function getBrowserRpcEndpoint(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/rpc`;
  }
  // SSR placeholder — wallet provider only runs on the client.
  return "https://api.mainnet-beta.solana.com";
}
