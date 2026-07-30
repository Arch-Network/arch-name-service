import type { AnsTransport } from "../transport/types.js";

/**
 * How long a confirmation wait persists by default.
 *
 * Measured against live testnet on 2026-07-28: two faucet account creations
 * took 24.6s and 63.7s from submission to the account being readable, and a
 * name registration took 15.2s. The spread is what matters — a deadline tuned
 * to the fast case trades one spurious failure for another. Pinned by a test.
 */
export const DEFAULT_CONFIRM_TIMEOUT_MS = 90_000;

/**
 * The node accepted the transaction, but it had not settled by the deadline.
 *
 * Distinct from a failure on purpose, and the distinction is the whole point:
 * `send_transaction` already returned a txid, so the network has the
 * transaction and may well apply it a moment after the wait gives up. Callers
 * must present this as "not confirmed yet", never as "your change did not
 * happen" — the latter is what turned a set-primary that landed on-chain into
 * "Set as primary failed".
 */
export class TransactionPendingError extends Error {
  readonly code = "TRANSACTION_PENDING" as const;

  constructor(
    readonly txid: string,
    /** The most recent status-lookup failure, when the wait had one. */
    readonly lastLookupError?: Error,
  ) {
    super(
      `Transaction ${txid} was submitted but the network has not confirmed it yet` +
        (lastLookupError ? `; last status lookup failed: ${lastLookupError.message}` : ""),
    );
    this.name = "TransactionPendingError";
  }
}

export function isTransactionPendingError(
  error: unknown,
): error is TransactionPendingError {
  return (
    error instanceof TransactionPendingError ||
    (error instanceof Error && (error as { code?: string }).code === "TRANSACTION_PENDING")
  );
}

export type ConfirmOutcome =
  /** The transaction settled successfully, or the caller's own signal fired. */
  | { status: "complete" }
  /**
   * Neither success nor definite failure within the deadline. `lastLookupError`
   * is the most recent status-lookup failure, if any, so the caller's timeout
   * copy can say what went wrong instead of only that time ran out.
   */
  | { status: "timeout"; lastLookupError?: Error };

/**
 * Wait for a submitted transaction, aborting early *only* on a definite
 * `Failed` status.
 *
 * Everything else — a status lookup that throws, an endpoint that has not
 * indexed the transaction, a transient network error — is a reason to keep
 * waiting, not a reason to fail. A transaction the network already accepted
 * cannot be un-submitted by a failed poll, so reporting a lookup problem as a
 * transaction failure is always wrong: it tells the user nothing happened when
 * something did. That is exactly how a not-yet-indexed transaction turned a
 * healthy registration into "Registration failed".
 *
 * Bounded by wall-clock time rather than an attempt count, so a slow endpoint
 * cannot silently stretch the wait to minutes.
 */
export async function waitForTransaction(params: {
  transport: AnsTransport;
  txid: string;
  /**
   * An independent success signal, e.g. "the account this transaction creates
   * is now readable". When given it is authoritative: a `Processed` status
   * alone does not end the wait, because the caller's next step needs the
   * *effect* of the transaction to be visible, not just its receipt.
   */
  isComplete?: () => Promise<boolean>;
  /** Defaults to {@link DEFAULT_CONFIRM_TIMEOUT_MS}. */
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<ConfirmOutcome> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  const intervalMs = params.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let lastLookupError: Error | undefined;
  let processed = false;

  for (;;) {
    if (params.isComplete) {
      try {
        if (await params.isComplete()) return { status: "complete" };
      } catch (error) {
        // The success probe is a read; a failed read is not a failed
        // transaction. Remembered, then retried.
        lastLookupError = error instanceof Error ? error : new Error(String(error));
      }
    }

    // Only the transaction's own `Failed` status ends the wait early, so it is
    // raised after the catch rather than from inside it — otherwise the block
    // that swallows lookup errors would swallow the failure too.
    let failure: Error | undefined;
    try {
      const status = await params.transport.getProcessedTransaction(params.txid);
      if (status?.status === "Failed") {
        failure = new Error(status.error ?? `transaction ${params.txid} failed`);
      } else if (status && /processed|confirmed|finalized/i.test(status.status)) {
        processed = true;
        // Without an `isComplete` signal the receipt is all there is to wait for.
        if (!params.isComplete) return { status: "complete" };
      }
    } catch (error) {
      lastLookupError = error instanceof Error ? error : new Error(String(error));
    }
    if (failure) throw failure;

    if (Date.now() + intervalMs > deadline) {
      return {
        status: "timeout",
        lastLookupError: processed ? undefined : lastLookupError,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
