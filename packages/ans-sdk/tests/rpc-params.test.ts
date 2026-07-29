import { afterEach, describe, expect, it, vi } from "vitest";

import { createArchRpcTransport } from "../src/transport/arch-rpc.js";
import { archRpcParams } from "../src/transport/rpc-params.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const PUBKEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const PUBKEY_BYTES = Array.from(PUBKEY);
const TXID = "9d6db00dc5a89480bc7ad24dc6bcd11432b7a55777b20f6b4954a109d55d1aca";

function stubRpc(result: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0): unknown {
  const [, init] = fetchMock.mock.calls[call]!;
  return JSON.parse(String(init.body));
}

/**
 * Exact wire payloads, one per method.
 *
 * These are fixtures, not shape assertions: they pin the whole JSON-RPC
 * envelope against what the live indexer at https://id.arch.network/rpc was
 * verified to accept on 2026-07-28, so flipping a pubkey between flat and
 * nested — the recurring regression in this repo — fails here instead of in
 * production. See `src/transport/rpc-params.ts` for the accepted/rejected table.
 */
describe("Arch JSON-RPC wire payloads", () => {
  it("read_account_info nests the pubkey in a single-element array", async () => {
    const fetchMock = stubRpc({ data: [], owner: [], lamports: 0, is_executable: false });

    await createArchRpcTransport("/rpc").readAccountInfo(PUBKEY);

    expect(sentBody(fetchMock)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "read_account_info",
      params: [PUBKEY_BYTES],
    });
  });

  it("get_program_accounts sends [program_id, filters]", async () => {
    const fetchMock = stubRpc([]);
    const filters = [{ DataSize: 128 }];

    await createArchRpcTransport("/rpc").getProgramAccounts?.(PUBKEY, filters);

    expect(sentBody(fetchMock)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "get_program_accounts",
      params: [PUBKEY_BYTES, filters],
    });
  });

  it("get_multiple_accounts nests the pubkey list one level for the indexer", async () => {
    const fetchMock = stubRpc([null, null]);
    const other = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);

    await createArchRpcTransport("/rpc").getMultipleAccounts?.([PUBKEY, other]);

    expect(sentBody(fetchMock)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "get_multiple_accounts",
      params: [[PUBKEY_BYTES, Array.from(other)]],
    });
  });

  it("get_processed_transaction sends { tx_id } with lowercase 64-char hex", async () => {
    const fetchMock = stubRpc({ status: { type: "Processed" } });

    await createArchRpcTransport("/rpc").getProcessedTransaction(`0x${TXID.toUpperCase()}`);

    expect(sentBody(fetchMock)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "get_processed_transaction",
      params: { tx_id: TXID },
    });
  });

  it("send_transaction sends the transaction object as params, not [tx]", async () => {
    const fetchMock = stubRpc("txid");

    await createArchRpcTransport("/rpc").sendTransaction({
      version: 0,
      signatures: [new Uint8Array([1, 2])],
      message: {
        header: {
          num_required_signatures: 1,
          num_readonly_signed_accounts: 0,
          num_readonly_unsigned_accounts: 2,
        },
        account_keys: [PUBKEY],
        recent_blockhash: new Uint8Array(32),
        instructions: [{ program_id_index: 2, accounts: [0, 1], data: new Uint8Array([9]) }],
      },
    });

    expect(sentBody(fetchMock)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "send_transaction",
      params: {
        version: 0,
        signatures: [[1, 2]],
        message: {
          header: {
            num_required_signatures: 1,
            num_readonly_signed_accounts: 0,
            num_readonly_unsigned_accounts: 2,
          },
          account_keys: [PUBKEY_BYTES],
          recent_blockhash: Array.from(new Uint8Array(32)),
          instructions: [{ program_id_index: 2, accounts: [0, 1], data: [9] }],
        },
      },
    });
  });

  it("get_best_block_hash sends empty params", async () => {
    const fetchMock = stubRpc(Array.from(new Uint8Array(32)));

    await createArchRpcTransport("/rpc").getBestBlockHash();

    expect(sentBody(fetchMock)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "get_best_block_hash",
      params: [],
    });
  });

  it("falls back from the unsupported get_slot to get_block_count", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32601, message: "Method not found" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 38941602 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createArchRpcTransport("/rpc").getCurrentSlot()).resolves.toBe(38941602n);
    expect(sentBody(fetchMock, 0)).toMatchObject({ method: "get_slot", params: [] });
    expect(sentBody(fetchMock, 1)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "get_block_count",
      params: [],
    });
  });

  /**
   * The faucet has no transport method — the manager calls it directly, because
   * it returns an unsigned transaction rather than a modelled result — so the
   * builder is pinned here. This is the shape that has flipped before: flat,
   * unlike `read_account_info` on the very same endpoint.
   */
  it("create_account_with_faucet spreads the pubkey flat across params", () => {
    expect(archRpcParams.create_account_with_faucet(PUBKEY)).toEqual(PUBKEY_BYTES);
    expect(archRpcParams.create_account_with_faucet(PUBKEY)).toHaveLength(32);
    expect(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "create_account_with_faucet",
        params: archRpcParams.create_account_with_faucet(PUBKEY),
      }),
    ).toBe(
      `{"jsonrpc":"2.0","id":1,"method":"create_account_with_faucet","params":[${PUBKEY_BYTES.join(",")}]}`,
    );
  });

  it("rejects a pubkey that is not 32 bytes before it reaches the wire", async () => {
    const fetchMock = stubRpc(null);

    await expect(
      createArchRpcTransport("/rpc").readAccountInfo(new Uint8Array(33)),
    ).rejects.toThrow("Arch pubkey must be 32 bytes, got 33");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed txid before it reaches the wire", async () => {
    const fetchMock = stubRpc(null);

    await expect(
      createArchRpcTransport("/rpc").getProcessedTransaction("deadbeef"),
    ).rejects.toThrow("Arch txid must be 64 hex characters");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
