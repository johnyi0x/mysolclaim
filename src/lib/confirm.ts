import type { Connection } from "@solana/web3.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Confirm a signature by polling HTTP RPC only.
 *
 * Our browser Connection uses `/api/rpc` (HTTP). web3.js `confirmTransaction`
 * also opens a WebSocket to `wss://…/api/rpc`, which does not exist — so
 * confirmation hangs forever on "Confirming…" and the next wallet popup never
 * appears. Polling `getSignatureStatuses` avoids that.
 */
export async function confirmSignaturePolled(
  connection: Connection,
  signature: string,
  opts?: {
    timeoutMs?: number;
    intervalMs?: number;
  }
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const intervalMs = opts?.intervalMs ?? 1_400;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];

    if (status?.err) {
      throw new Error(
        `Transaction failed on-chain: ${JSON.stringify(status.err)} (${signature})`
      );
    }

    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return;
    }

    await sleep(intervalMs);
  }

  // Last chance: full getTransaction (still HTTP).
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (tx) {
    if (tx.meta?.err) {
      throw new Error(
        `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)} (${signature})`
      );
    }
    return;
  }

  throw new Error(
    `Confirmation timed out for ${signature}. Open Solscan — the tx may still have landed. If it did, rescan and continue.`
  );
}
