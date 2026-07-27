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

function isAccountMissingError(message: string | undefined): boolean {
  return (message ?? "").toLowerCase().includes("account is not in database");
}

async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
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

function toNumberArray(value: unknown): number[] {
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map((item) => Number(item) || 0);
  if (value && typeof value === "object") {
    // JSON.stringify(Uint8Array) yields {"0":n,"1":n,...}; undo that.
    const entries = Object.keys(value)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => Number((value as Record<string, unknown>)[key]) || 0);
    if (entries.length > 0) return entries;
  }
  return [];
}

/**
 * Arch JSON-RPC rejects Uint8Array fields (they serialize as maps). Convert
 * every byte buffer to a plain number[] before submission.
 */
export function normalizeRuntimeTransaction(value: unknown): {
  version: number;
  signatures: number[][];
  message: {
    header: {
      num_required_signatures: number;
      num_readonly_signed_accounts: number;
      num_readonly_unsigned_accounts: number;
    };
    account_keys: number[][];
    recent_blockhash: number[];
    instructions: Array<{
      program_id_index: number;
      accounts: number[];
      data: number[];
    }>;
  };
} {
  const tx = (value ?? {}) as {
    version?: unknown;
    signatures?: unknown;
    message?: {
      header?: {
        num_required_signatures?: unknown;
        num_readonly_signed_accounts?: unknown;
        num_readonly_unsigned_accounts?: unknown;
      };
      account_keys?: unknown;
      recent_blockhash?: unknown;
      instructions?: Array<{
        program_id_index?: unknown;
        accounts?: unknown;
        data?: unknown;
      }>;
    };
  };

  return {
    version: typeof tx.version === "number" ? tx.version : 0,
    signatures: Array.isArray(tx.signatures)
      ? tx.signatures.map((sig) => toNumberArray(sig))
      : [],
    message: {
      header: {
        num_required_signatures: Number(tx.message?.header?.num_required_signatures) || 0,
        num_readonly_signed_accounts:
          Number(tx.message?.header?.num_readonly_signed_accounts) || 0,
        num_readonly_unsigned_accounts:
          Number(tx.message?.header?.num_readonly_unsigned_accounts) || 0,
      },
      account_keys: Array.isArray(tx.message?.account_keys)
        ? tx.message.account_keys.map((key) => toNumberArray(key))
        : [],
      recent_blockhash: toNumberArray(tx.message?.recent_blockhash),
      instructions: Array.isArray(tx.message?.instructions)
        ? tx.message.instructions.map((ix) => ({
            program_id_index: Number(ix.program_id_index) || 0,
            accounts: Array.isArray(ix.accounts)
              ? ix.accounts.map((account) => Number(account) || 0)
              : [],
            data: toNumberArray(ix.data),
          }))
        : [],
    },
  };
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
      try {
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
      } catch (error) {
        // Arch RPC returns a JSON-RPC error for missing accounts instead of null.
        if (error instanceof Error && isAccountMissingError(error.message)) {
          return null;
        }
        throw error;
      }
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
      // Direct Arch RPC expects the runtime tx as the bare `params` object
      // (not `[tx]`). Uint8Array fields must be plain number arrays.
      return rpc<string>(rpcUrl, "send_transaction", normalizeRuntimeTransaction(transaction));
    },

    async getProcessedTransaction(txid) {
      const result = await rpc<{ status?: unknown; error?: string } | null>(
        rpcUrl,
        "get_processed_transaction",
        { tx_id: txid },
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
