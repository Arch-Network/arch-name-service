import { describe, expect, it, vi } from "vitest";

import { createExplorerRestTransport } from "../src/transport/explorer-rest.js";

const TXID = "ab".repeat(32);
const HASH = "cd".repeat(32);

describe("createExplorerRestTransport", () => {
  it("serializes exact native REST URLs and normalizes responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ slot_height: 123 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ blocks: [{ hash: HASH }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "Processed" }), { status: 200 }),
      );
    const transport = createExplorerRestTransport("/explorer/", {
      fetch: fetchMock,
      retries: 0,
    });

    await expect(transport.getCurrentSlot()).resolves.toBe(123n);
    await expect(transport.getBestBlockHash()).resolves.toEqual(
      Uint8Array.from({ length: 32 }, () => 0xcd),
    );
    await expect(transport.getProcessedTransaction(TXID)).resolves.toEqual({
      status: "Processed",
      error: undefined,
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/explorer/network/stats",
      "/explorer/blocks?limit=1",
      `/explorer/transactions/${TXID}`,
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        method: "GET",
        headers: { accept: "application/json" },
      });
    }
  });

  it("maps a transaction 404 to not indexed", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    const transport = createExplorerRestTransport("/explorer", {
      fetch: fetchMock,
      retries: 0,
    });

    await expect(transport.getProcessedTransaction(TXID)).resolves.toBeNull();
  });

  it("retries 429 and 5xx responses", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: { type: "Processed" } }), { status: 200 }),
      );
    const transport = createExplorerRestTransport("/explorer", {
      fetch: fetchMock,
      retries: 2,
    });

    await expect(transport.getProcessedTransaction(TXID)).resolves.toEqual({
      status: "Processed",
      error: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces a terminal 5xx", async () => {
    const transport = createExplorerRestTransport("/explorer", {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("down", { status: 502 })),
      retries: 0,
    });

    await expect(transport.getProcessedTransaction(TXID)).rejects.toThrow(
      "Explorer REST HTTP 502",
    );
  });

  /**
   * `window.fetch` throws `TypeError: Failed to execute 'fetch' on 'Window':
   * Illegal invocation` when its receiver is not the global object, so the
   * transport must never invoke a stored reference as a method of its options
   * bag. `strictFetch` reproduces that browser check, which a plain `vi.fn()`
   * does not.
   */
  function strictFetch(response: Response): typeof globalThis.fetch {
    return function boundOnlyFetch(this: unknown) {
      if (this !== globalThis && this !== undefined) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'Window': Illegal invocation",
        );
      }
      return Promise.resolve(response.clone());
    } as typeof globalThis.fetch;
  }

  it("calls an injected fetch with the global as its receiver", async () => {
    const transport = createExplorerRestTransport("/explorer", {
      fetch: strictFetch(new Response(JSON.stringify({ slot_height: 7 }), { status: 200 })),
      retries: 0,
    });

    await expect(transport.getCurrentSlot()).resolves.toBe(7n);
  });

  it("calls the default global fetch with the global as its receiver", async () => {
    vi.stubGlobal(
      "fetch",
      strictFetch(new Response(JSON.stringify({ blocks: [{ hash: HASH }] }), { status: 200 })),
    );
    try {
      const transport = createExplorerRestTransport("/explorer", { retries: 0 });
      await expect(transport.getBestBlockHash()).resolves.toEqual(
        Uint8Array.from({ length: 32 }, () => 0xcd),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("normalizes a definite failure", async () => {
    const transport = createExplorerRestTransport("/explorer", {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ status: { type: "Failed", error: "instruction failed" } }),
          { status: 200 },
        ),
      ),
      retries: 0,
    });

    await expect(transport.getProcessedTransaction(TXID)).resolves.toEqual({
      status: "Failed",
      error: "instruction failed",
    });
  });
});
