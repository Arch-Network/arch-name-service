import { describe, expect, it, vi } from "vitest";

import { createArchRpcTransport } from "../src/transport/arch-rpc.js";
import {
  DEFAULT_CONFIRM_TIMEOUT_MS,
  waitForTransaction,
} from "../src/transactions/confirm.js";
import type { AnsTransport } from "../src/transport/types.js";

const TXID = "9d6db00dc5a89480bc7ad24dc6bcd11432b7a55777b20f6b4954a109d55d1aca";

/**
 * The byte-exact body `https://id.arch.network/rpc` returns for a txid the
 * Explorer indexer has not ingested yet. Captured live on 2026-07-28 and
 * confirmed identical from the upstream Explorer endpoint and through the CDK
 * proxy Lambda, so the proxy is not reshaping it.
 */
const PROXY_UNINDEXED_BODY = {
  error: {
    code: -32602,
    data: "invalid type: sequence, expected a string at line 1 column 0",
    message: "Invalid params",
  },
  id: 1,
  jsonrpc: "2.0",
};

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

/**
 * Tiny timings so the deadline logic is exercised in real time, not mocked.
 * The deadline is kept an order of magnitude above the ~20ms the "completes"
 * cases need, because a margin tight enough to lose a race on a loaded CI box
 * makes this file fail for reasons that have nothing to do with the logic.
 */
const fast = { timeoutMs: 300, intervalMs: 10 };

describe("DEFAULT_CONFIRM_TIMEOUT_MS", () => {
  /**
   * Live testnet account creation was measured at 24.6s on 2026-07-28. A
   * deadline near that would swap the -32602 failure for a timeout failure, so
   * the floor is pinned here rather than left to a future tidy-up.
   */
  it("leaves generous room above the ~25s a real account creation takes", () => {
    expect(DEFAULT_CONFIRM_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe("waitForTransaction", () => {
  it("returns complete once the caller's own signal fires", async () => {
    let visible = false;
    setTimeout(() => {
      visible = true;
    }, 15);

    await expect(
      waitForTransaction({
        transport: transportWith({}),
        txid: TXID,
        isComplete: async () => visible,
        ...fast,
      }),
    ).resolves.toEqual({ status: "complete" });
  });

  it("returns complete on a Processed receipt when there is no other signal", async () => {
    await expect(
      waitForTransaction({
        transport: transportWith({
          getProcessedTransaction: async () => ({ status: "Processed" }),
        }),
        txid: TXID,
        ...fast,
      }),
    ).resolves.toEqual({ status: "complete" });
  });

  it("aborts immediately on a definite Failed status", async () => {
    await expect(
      waitForTransaction({
        transport: transportWith({
          getProcessedTransaction: async () => ({
            status: "Failed",
            error: "insufficient funds",
          }),
        }),
        txid: TXID,
        isComplete: async () => false,
        ...fast,
      }),
    ).rejects.toThrow("insufficient funds");
  });

  /**
   * The whole point. A status lookup that throws cannot un-submit a transaction
   * the network already accepted, so it must never end the wait.
   */
  it("keeps waiting when every status lookup throws, then succeeds", async () => {
    let lookups = 0;
    let visible = false;
    setTimeout(() => {
      visible = true;
    }, 25);

    const outcome = await waitForTransaction({
      transport: transportWith({
        getProcessedTransaction: async () => {
          lookups += 1;
          throw new Error("Invalid params (invalid type: sequence, expected a string)");
        },
      }),
      txid: TXID,
      isComplete: async () => visible,
      ...fast,
    });

    expect(outcome).toEqual({ status: "complete" });
    expect(lookups).toBeGreaterThan(0);
  });

  it("reports the last lookup failure when the deadline passes", async () => {
    const outcome = await waitForTransaction({
      transport: transportWith({
        getProcessedTransaction: async () => {
          throw new Error("gateway timeout");
        },
      }),
      txid: TXID,
      isComplete: async () => false,
      ...fast,
    });

    expect(outcome.status).toBe("timeout");
    expect(outcome.status === "timeout" && outcome.lastLookupError?.message).toBe(
      "gateway timeout",
    );
  });

  it("tolerates a success probe that throws", async () => {
    const outcome = await waitForTransaction({
      transport: transportWith({}),
      txid: TXID,
      isComplete: async () => {
        throw new Error("account read failed");
      },
      ...fast,
    });

    expect(outcome.status).toBe("timeout");
    expect(outcome.status === "timeout" && outcome.lastLookupError?.message).toBe(
      "account read failed",
    );
  });

  /**
   * End-to-end through the real transport: the exact bytes the live proxy
   * returns for an un-indexed txid must read as "keep waiting", so the account
   * appearing a moment later still completes the wait.
   */
  it("survives the live proxy's un-indexed -32602 body end to end", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(PROXY_UNINDEXED_BODY), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    let visible = false;
    setTimeout(() => {
      visible = true;
    }, 20);

    const outcome = await waitForTransaction({
      transport: createArchRpcTransport("/rpc"),
      txid: TXID,
      isComplete: async () => visible,
      ...fast,
    });

    expect(outcome).toEqual({ status: "complete" });
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  /**
   * Defence in depth: even if the transport ever stops recognising that error
   * body, the wait itself still has to survive it. Simulated by a transport
   * that rethrows instead of returning null.
   */
  it("survives the un-indexed body even if the transport stops tolerating it", async () => {
    let visible = false;
    setTimeout(() => {
      visible = true;
    }, 20);

    const outcome = await waitForTransaction({
      transport: transportWith({
        getProcessedTransaction: async () => {
          throw Object.assign(new Error("Invalid params"), {
            code: -32602,
            data: PROXY_UNINDEXED_BODY.error.data,
          });
        },
      }),
      txid: TXID,
      isComplete: async () => visible,
      ...fast,
    });

    expect(outcome).toEqual({ status: "complete" });
  });
});
