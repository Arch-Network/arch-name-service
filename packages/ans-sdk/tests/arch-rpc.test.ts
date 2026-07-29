import { afterEach, describe, expect, it, vi } from "vitest";

import { SYSTEM_PROGRAM_ID } from "../src/constants.js";
import {
  ArchRpcError,
  createArchRpcTransport,
  isTransactionNotIndexedError,
} from "../src/transport/arch-rpc.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createArchRpcTransport", () => {
  it("sends read_account_info as [pubkey]", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { data: [], owner: [], lamports: 0, is_executable: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pubkey = Uint8Array.from({ length: 32 }, (_, index) => index);
    await createArchRpcTransport("/rpc").readAccountInfo(pubkey);

    const [, init] = fetchMock.mock.calls[0]!;
    const request = JSON.parse(String(init.body));
    expect(request.method).toBe("read_account_info");
    expect(request.params).toEqual([Array.from(pubkey)]);
  });

  it("treats indexer 'account <hex> not found' as null", async () => {
    const pubkey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const hex = Array.from(pubkey, (b) => b.toString(16).padStart(2, "0")).join("");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32002, message: `account ${hex} not found` },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createArchRpcTransport("/rpc").readAccountInfo(pubkey),
    ).resolves.toBeNull();
  });

  it("treats validator 'account is not in database' as null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32002, message: "Account is not in database" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createArchRpcTransport("/rpc").readAccountInfo(new Uint8Array(32)),
    ).resolves.toBeNull();
  });

  it("still throws for unrelated RPC errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32000, message: "method not allowed" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createArchRpcTransport("/rpc").readAccountInfo(new Uint8Array(32)),
    ).rejects.toThrow("method not allowed");
  });

  it("sends get_program_accounts as [program_id, filters]", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const programId = Uint8Array.from({ length: 32 }, (_, index) => index);
    const filters = [{ DataSize: 128 }];
    await createArchRpcTransport("/rpc").getProgramAccounts?.(
      programId,
      filters,
    );

    const [, init] = fetchMock.mock.calls[0]!;
    const request = JSON.parse(String(init.body));
    expect(request.method).toBe("get_program_accounts");
    expect(request.params).toEqual([Array.from(programId), filters]);
  });

  it("batches get_multiple_accounts and caches results for follow-up reads", async () => {
    const pubkey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: [
            {
              key: Array.from(pubkey),
              data: [1, 2, 3],
              owner: Array.from(pubkey),
              lamports: 42,
              is_executable: false,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const transport = createArchRpcTransport("/rpc");
    const [first] = await transport.getMultipleAccounts!([pubkey]);
    expect(first).toEqual({
      data: Uint8Array.from([1, 2, 3]),
      owner: pubkey,
      lamports: 42,
      isExecutable: false,
    });
    // Cache hit — no second network call.
    await expect(transport.readAccountInfo(pubkey)).resolves.toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent identical read_account_info calls", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pubkey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const transport = createArchRpcTransport("/rpc");
    const a = transport.readAccountInfo(pubkey);
    const b = transport.readAccountInfo(pubkey);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch!(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { data: [], owner: [], lamports: 0, is_executable: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(Promise.all([a, b])).resolves.toHaveLength(2);
  });
});

describe("getProcessedTransaction", () => {
  const TXID = "9d6db00dc5a89480bc7ad24dc6bcd11432b7a55777b20f6b4954a109d55d1aca";

  function stubResponse(body: unknown): void {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  }

  /**
   * The bug behind "Registration failed — the testnet faucet rejected account
   * setup (invalid RPC params)". The indexer forwards a txid it has not ingested
   * upstream in the wrong params shape, so a not-yet-visible transaction returns
   * -32602 instead of an empty result. Confirmation polls always start inside
   * that window, so this has to read as "keep waiting", not as a failure.
   */
  it("treats the indexer's -32602 for an un-indexed txid as not yet available", async () => {
    stubResponse({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32602,
        message: "Invalid params",
        data: "invalid type: sequence, expected a string at line 1 column 0",
      },
    });

    await expect(
      createArchRpcTransport("/rpc").getProcessedTransaction(TXID),
    ).resolves.toBeNull();
  });

  /**
   * The live body, byte for byte, as the user's own network tab captured it on
   * a set-primary. Anything less than an exact-body test lets a paraphrase pass
   * while the real thing still fails.
   */
  it("tolerates the live body byte for byte", async () => {
    stubResponse({
      error: {
        code: -32602,
        data: "invalid type: sequence, expected a string at line 1 column 0",
        message: "Invalid params",
      },
      id: 1,
      jsonrpc: "2.0",
    });

    await expect(
      createArchRpcTransport("/rpc").getProcessedTransaction(
        "cd4d5b984aeb3218345b0197e6ae6dca11db0a1449f2a9cff75b5fbbb1e7599e",
      ),
    ).resolves.toBeNull();
  });

  it("still throws for an invalid-params error that is not that fallback", async () => {
    stubResponse({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32602,
        message: "`tx_id` must be a 32-byte array, 64-char hex string, or base58 string",
      },
    });

    await expect(
      createArchRpcTransport("/rpc").getProcessedTransaction(TXID),
    ).rejects.toThrow("`tx_id` must be a 32-byte array");
  });

  it("reads the indexer's `status: { type }` envelope", async () => {
    stubResponse({ jsonrpc: "2.0", id: 1, result: { status: { type: "Processed" } } });

    await expect(
      createArchRpcTransport("/rpc").getProcessedTransaction(TXID),
    ).resolves.toEqual({ status: "Processed", error: undefined });
  });

  it("surfaces a failed transaction from the `status: { type }` envelope", async () => {
    stubResponse({
      jsonrpc: "2.0",
      id: 1,
      result: { status: { type: "Failed" }, error: "insufficient funds" },
    });

    await expect(
      createArchRpcTransport("/rpc").getProcessedTransaction(TXID),
    ).resolves.toEqual({ status: "Failed", error: "insufficient funds" });
  });

  it("keeps the serde detail on the error message for support", async () => {
    stubResponse({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32602,
        message: "Invalid params",
        data: "invalid type: map, expected u32 at line 1 column 1",
      },
    });

    await expect(
      createArchRpcTransport("/rpc").sendTransaction({}),
    ).rejects.toThrow("Invalid params (invalid type: map, expected u32 at line 1 column 1)");
  });
});

/**
 * The transport turns the un-indexed reply into `null` at the source, so this
 * predicate only ever matters once the error has been re-thrown, re-wrapped, or
 * folded into some other message. Every one of those layers has to keep
 * answering "not indexed yet" — one that does not is how a JSON-RPC dump ends
 * up in front of a user whose transaction succeeded.
 */
describe("isTransactionNotIndexedError", () => {
  const DETAIL = "invalid type: sequence, expected a string at line 1 column 0";
  const raw = new ArchRpcError("get_processed_transaction", {
    code: -32602,
    message: "Invalid params",
    data: DETAIL,
  });

  it("recognises the transport's own error", () => {
    expect(isTransactionNotIndexedError(raw)).toBe(true);
  });

  it("recognises a plain object carrying the code and detail", () => {
    expect(isTransactionNotIndexedError({ code: -32602, data: DETAIL })).toBe(true);
  });

  it("recognises it through a cause chain", () => {
    const wrapped = new Error("Set as primary failed", {
      cause: new Error("confirmation failed", { cause: raw }),
    });
    expect(isTransactionNotIndexedError(wrapped)).toBe(true);
  });

  it("recognises it after the detail is flattened into a message", () => {
    // `new Error(cause.message)` loses `code` and `data` but keeps the text,
    // and that is exactly the shape the manager used to re-throw.
    expect(isTransactionNotIndexedError(new Error(raw.message))).toBe(true);
    expect(isTransactionNotIndexedError(`last status lookup failed: ${raw.message}`)).toBe(
      true,
    );
  });

  it("does not match a different invalid-params failure", () => {
    expect(
      isTransactionNotIndexedError(
        new ArchRpcError("send_transaction", {
          code: -32602,
          message: "Invalid params",
          data: "invalid type: map, expected u32 at line 1 column 1",
        }),
      ),
    ).toBe(false);
    expect(isTransactionNotIndexedError(new Error("Invalid params"))).toBe(false);
    expect(isTransactionNotIndexedError(null)).toBe(false);
  });

  it("terminates on a cyclic cause chain", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isTransactionNotIndexedError(a)).toBe(false);
  });
});

describe("SYSTEM_PROGRAM_ID", () => {
  it("is the all-zero Arch system program pubkey", () => {
    expect(SYSTEM_PROGRAM_ID).toEqual(new Uint8Array(32));
  });
});
