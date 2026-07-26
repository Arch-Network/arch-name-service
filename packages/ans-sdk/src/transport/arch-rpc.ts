import { hexToBytes } from "../hex.js";
import type {
  AccountInfo,
  AnsTransport,
  ProcessedTransaction,
  ProgramAccountEntry,
} from "./types.js";

type JsonRpcResponse<T> = {
  result?: T;
  error?: { message?: string };
};

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  if (!response.ok) {
    throw new Error(`Arch RPC HTTP ${response.status}`);
  }
  const body = (await response.json()) as JsonRpcResponse<T>;
  if (body.error) {
    throw new Error(body.error.message ?? `Arch RPC error for ${method}`);
  }
  return body.result as T;
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") {
    return hexToBytes(value);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value.map((item) => Number(item) || 0));
  }
  return new Uint8Array();
}

/**
 * Arch RPC deserializes pubkey methods as a flat `[u8; 32]` params array
 * (not a nested `[pubkey]`). Hex strings are accepted by converting first.
 */
function pubkeyParams(pubkey: Uint8Array | string): number[] {
  const bytes =
    typeof pubkey === "string" ? hexToBytes(pubkey.replace(/^0x/i, "")) : pubkey;
  if (bytes.length !== 32) {
    throw new Error(`Arch pubkey must be 32 bytes, got ${bytes.length}`);
  }
  return Array.from(bytes);
}

/**
 * Direct Arch JSON-RPC transport for browsers and Node.
 * Works against endpoints that expose `read_account_info` / `send_transaction`.
 */
export function createArchRpcTransport(rpcUrl: string): AnsTransport {
  return {
    async readAccountInfo(pubkey) {
      const result = await rpc<{
        data?: unknown;
        owner?: unknown;
        lamports?: number;
        is_executable?: boolean;
      } | null>(rpcUrl, "read_account_info", pubkeyParams(pubkey));
      if (!result) return null;
      return {
        data: toBytes(result.data),
        owner: toBytes(result.owner),
        lamports: result.lamports ?? 0,
        isExecutable: Boolean(result.is_executable),
      } satisfies AccountInfo;
    },

    async getProgramAccounts(programId, filters = []) {
      // Some nodes accept `[programIdBytes..., filters]`; prefer a dedicated
      // method signature when available. Flat pubkey + optional filters object.
      const result = await rpc<
        Array<{ pubkey?: unknown; account?: { data?: unknown; owner?: unknown; lamports?: number; is_executable?: boolean } }>
      >(rpcUrl, "get_program_accounts", [...pubkeyParams(programId), filters]);
      return (result ?? []).map((entry) => ({
        pubkey: toBytes(entry.pubkey),
        account: {
          data: toBytes(entry.account?.data),
          owner: toBytes(entry.account?.owner),
          lamports: entry.account?.lamports ?? 0,
          isExecutable: Boolean(entry.account?.is_executable),
        },
      })) satisfies ProgramAccountEntry[];
    },

    async getCurrentSlot() {
      // Prefer an explicit slot method when available; fall back to block height.
      try {
        const slot = await rpc<number | string>(rpcUrl, "get_slot", []);
        return BigInt(slot);
      } catch {
        const height = await rpc<number | string>(rpcUrl, "get_block_count", []);
        return BigInt(height);
      }
    },

    async getBestBlockHash() {
      const hash = await rpc<string | number[]>(rpcUrl, "get_best_block_hash", []);
      return toBytes(hash);
    },

    async sendTransaction(transaction) {
      return rpc<string>(rpcUrl, "send_transaction", [transaction]);
    },

    async getProcessedTransaction(txid) {
      const result = await rpc<{ status?: unknown; error?: string } | null>(
        rpcUrl,
        "get_processed_transaction",
        [txid],
      );
      if (!result) return null;
      if (typeof result.status === "string") {
        return { status: result.status, error: result.error } satisfies ProcessedTransaction;
      }
      if (result.status && typeof result.status === "object") {
        const statusObj = result.status as Record<string, unknown>;
        if ("Failed" in statusObj) {
          return {
            status: "Failed",
            error: String(statusObj.Failed ?? result.error ?? "failed"),
          };
        }
        if ("Processed" in statusObj || "Confirmed" in statusObj) {
          return { status: "Processed" };
        }
      }
      return { status: String(result.status ?? "Unknown"), error: result.error };
    },
  };
}
