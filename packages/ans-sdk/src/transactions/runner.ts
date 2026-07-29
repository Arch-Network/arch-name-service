import {
  duplicateRegistrationError,
  isDuplicateRegistrationErrorMessage,
} from "../availability.js";
import type { AnsTransport } from "../transport/types.js";
import type { ArchAddress, BuiltInstruction } from "../types.js";
import type { TransactionSigner } from "../wallet/adapter.js";
import { buildTransaction, type RuntimeTransaction } from "./builder.js";
import { TransactionPendingError, waitForTransaction } from "./confirm.js";

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Build, sign, submit, and confirm one instruction.
 *
 * The single confirmation path for every ANS mutation — register, records,
 * primary set/clear, transfer — so they cannot drift apart in how long they
 * wait or what they call a failure. It waits on {@link waitForTransaction},
 * which aborts early only on a definite `Failed`, and reports "accepted but
 * unconfirmed" as {@link TransactionPendingError} rather than as an error the
 * caller is free to read as "nothing happened".
 *
 * Callers that can observe their own effect should pass `isComplete`. Without
 * it the only available signal is the transaction receipt, which the Explorer
 * indexer cannot serve until it has ingested the txid — so a change that had
 * already been applied on-chain still had to sit out the indexing lag before
 * anyone could say so.
 */
export async function signAndSendInstruction(params: {
  transport: AnsTransport;
  instruction: BuiltInstruction;
  feePayer: ArchAddress;
  signer: TransactionSigner;
  confirm?: boolean;
  /** Confirmation deadline and poll spacing; default to `waitForTransaction`'s. */
  confirmTimeoutMs?: number;
  confirmIntervalMs?: number;
  /**
   * "Has this transaction's effect become visible?" — e.g. the reverse account
   * now resolves to the name. Authoritative when given: it reads account state
   * rather than the transaction index, so it answers as soon as the change
   * lands instead of when the indexer catches up.
   */
  isComplete?: () => Promise<boolean>;
  /**
   * Fired once the node has accepted the transaction, before the confirmation
   * wait begins. The wait can run for a minute or more, and a UI with no
   * signal here spends it still saying "waiting for approval".
   */
  onSubmitted?: (txid: string) => void;
}): Promise<string> {
  const { transaction, messageHashHex } = await buildTransaction(
    params.transport,
    [params.instruction],
    params.feePayer,
  );
  const signatureHex = await params.signer(messageHashHex);
  const signed: RuntimeTransaction = {
    ...transaction,
    signatures: [Array.from(hexToBytes(signatureHex))],
  };
  const txid = await params.transport.sendTransaction(signed);
  params.onSubmitted?.(txid);
  if (params.confirm === false) return txid;

  try {
    const outcome = await waitForTransaction({
      transport: params.transport,
      txid,
      isComplete: params.isComplete,
      timeoutMs: params.confirmTimeoutMs,
      intervalMs: params.confirmIntervalMs,
    });
    if (outcome.status === "complete") return txid;
    throw new TransactionPendingError(txid, outcome.lastLookupError);
  } catch (error) {
    if (
      error instanceof Error &&
      isDuplicateRegistrationErrorMessage(error.message)
    ) {
      throw duplicateRegistrationError("name");
    }
    throw error;
  }
}
