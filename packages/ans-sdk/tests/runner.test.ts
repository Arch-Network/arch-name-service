/**
 * The single confirmation path every ANS mutation goes through.
 *
 * Register, records, primary set/clear and transfer all reach the network via
 * `signAndSendInstruction`, so what it decides to call a failure is what the
 * user is told about every one of them. Two rules are pinned here: a
 * transaction the node accepted is never reported as a failure just because
 * the confirmation lookup could not see it, and a definite `Failed` still
 * aborts immediately.
 */

import { describe, expect, it, vi } from "vitest";

import { TransactionPendingError } from "../src/transactions/confirm.js";
import { signAndSendInstruction } from "../src/transactions/runner.js";
import type { AnsTransport } from "../src/transport/types.js";
import { ArchRpcError } from "../src/transport/arch-rpc.js";

const TXID = "9d6db00dc5a89480bc7ad24dc6bcd11432b7a55777b20f6b4954a109d55d1aca";

/** The exact reply the live indexer gives for a txid it has not ingested. */
const notIndexed = () =>
  new ArchRpcError("get_processed_transaction", {
    code: -32602,
    message: "Invalid params",
    data: "invalid type: sequence, expected a string at line 1 column 0",
  });

function transportWith(overrides: Partial<AnsTransport>): AnsTransport {
  return {
    readAccountInfo: async () => null,
    getCurrentSlot: async () => 0n,
    getBestBlockHash: async () => new Uint8Array(32),
    sendTransaction: async () => TXID,
    getProcessedTransaction: async () => null,
    ...overrides,
  };
}

function run(
  transport: AnsTransport,
  onSubmitted?: (txid: string) => void,
  isComplete?: () => Promise<boolean>,
) {
  return signAndSendInstruction({
    transport,
    isComplete,
    // Short enough to exercise the deadline in real time rather than mock it.
    confirmTimeoutMs: isComplete ? 400 : 50,
    confirmIntervalMs: 10,
    instruction: {
      programId: new Uint8Array(32),
      accounts: [],
      data: new Uint8Array([4]),
    },
    feePayer: new Uint8Array(32),
    signer: async () => "ab".repeat(64),
    onSubmitted,
  });
}

describe("signAndSendInstruction", () => {
  it("returns the txid once the transaction is processed", async () => {
    await expect(
      run(transportWith({ getProcessedTransaction: async () => ({ status: "Processed" }) })),
    ).resolves.toBe(TXID);
  });

  it("announces submission before the confirmation wait begins", async () => {
    const onSubmitted = vi.fn();
    await run(
      transportWith({ getProcessedTransaction: async () => ({ status: "Processed" }) }),
      onSubmitted,
    );
    expect(onSubmitted).toHaveBeenCalledWith(TXID);
  });

  /**
   * The set-primary bug. The confirmation poll ran while the indexer had not
   * ingested the txid, and the generic failure it threw reached the UI as
   * "Set as primary failed" — for a transaction that was already applied.
   */
  it("reports an unconfirmed transaction as pending, not failed", async () => {
    const error = await run(
      transportWith({
        getProcessedTransaction: async () => {
          throw notIndexed();
        },
      }),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(TransactionPendingError);
    expect(error.txid).toBe(TXID);
    // Whatever a caller does with this, it must be able to say the
    // transaction exists — so the message may not read as "nothing happened".
    expect(error.message).toMatch(/submitted/i);
    expect(error.message).not.toMatch(/failed to|did not finish/i);
  });

  /**
   * The point of effect-based confirmation. No `params` shape makes the
   * indexer answer for a txid it has not ingested — probed exhaustively
   * against the live endpoint — so a confirmation built on the receipt alone
   * can only ever wait out the lag. Reading the account the mutation wrote
   * answers as soon as the change lands.
   */
  it("confirms on the observed effect even though the txid never indexes", async () => {
    let landed = false;
    setTimeout(() => {
      landed = true;
    }, 40);

    await expect(
      run(
        transportWith({
          getProcessedTransaction: async () => {
            throw notIndexed();
          },
        }),
        undefined,
        async () => landed,
      ),
    ).resolves.toBe(TXID);
  });

  /**
   * A receipt is not the effect. The page renders from account state, so
   * "processed" while the account still reads the old value would have the UI
   * announce a change it is about to display as not having happened.
   */
  it("keeps waiting when the receipt lands but the effect is not visible", async () => {
    const error = await run(
      transportWith({ getProcessedTransaction: async () => ({ status: "Processed" }) }),
      undefined,
      async () => false,
    ).catch((e) => e);

    expect(error).toBeInstanceOf(TransactionPendingError);
  });

  it("keeps waiting when the effect probe throws, then confirms", async () => {
    let landed = false;
    setTimeout(() => {
      landed = true;
    }, 40);

    await expect(
      run(transportWith({}), undefined, async () => {
        if (!landed) throw new Error("account read failed");
        return true;
      }),
    ).resolves.toBe(TXID);
  });

  it("still aborts on a definite Failed status", async () => {
    await expect(
      run(
        transportWith({
          getProcessedTransaction: async () => ({
            status: "Failed",
            error: "missing required signature",
          }),
        }),
      ),
    ).rejects.toThrow("missing required signature");
  });
});
