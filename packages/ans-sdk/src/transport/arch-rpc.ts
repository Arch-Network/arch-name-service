import { bytesToHex, hexToBytes } from "../hex.js";
import { archRpcParams } from "./rpc-params.js";
import type {
  AccountInfo,
  AnsTransport,
  ProcessedTransaction,
  ProgramAccountEntry,
} from "./types.js";

export { normalizeRuntimeTransaction } from "./rpc-params.js";

/** Brief in-memory TTL for identical account reads (Strict Mode / overlapping views). */
const ACCOUNT_CACHE_TTL_MS = 5_000;

type JsonRpcResponse<T> = {
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
};

/** A JSON-RPC error from an Arch endpoint, with the code and serde detail kept. */
export class ArchRpcError extends Error {
  readonly code: number | undefined;
  /** The server's `error.data`, which carries the serde type error when present. */
  readonly data: string | undefined;
  readonly method: string;

  constructor(method: string, error: { code?: number; message?: string; data?: unknown }) {
    const detail = typeof error.data === "string" ? error.data : undefined;
    const message = error.message ?? `Arch RPC error for ${method}`;
    super(detail ? `${message} (${detail})` : message);
    this.name = "ArchRpcError";
    this.method = method;
    this.code = error.code;
    this.data = detail;
  }
}

/**
 * Arch validators historically return "account is not in database"; the
 * Explorer indexer used by id.arch.network/rpc returns "account <hex> not found".
 * Both mean the account is absent and should surface as `null`.
 */
function isAccountMissingError(message: string | undefined): boolean {
  const normalized = (message ?? "").toLowerCase();
  return (
    normalized.includes("account is not in database") ||
    /account [0-9a-f]+ not found/.test(normalized) ||
    normalized.includes("account not found")
  );
}

/**
 * The serde detail the indexer returns for a txid it has not ingested yet.
 *
 * The indexer answers from its own store when it has already ingested the
 * transaction, and otherwise forwards the query upstream — but it forwards
 * `params` as a positional sequence to a handler that wants a bare string, so
 * an un-ingested txid comes back as `-32602 Invalid params` with
 * `data: "invalid type: sequence, expected a string at line 1 column 0"`
 * instead of an empty result.
 *
 * Probed exhaustively on 2026-07-29 against `id.arch.network/rpc` and against
 * the upstream Explorer endpoint directly, with an indexed txid and one the
 * indexer has never seen. Five encodings are accepted — `{tx_id: hex}`,
 * `["<hex>"]`, `{txid: hex}`, `[[bytes]]`, `{tx_id: [bytes]}` — and all five
 * behave identically: a result for an indexed txid, this exact error for an
 * un-indexed one. The bodies are byte-identical through the proxy and direct,
 * so the Lambda is not involved. **No request shape avoids this**; ANS's
 * `{tx_id}` is correct and changing it would fix nothing. A malformed txid
 * returns a different -32602 with no `data`.
 *
 * The indexer's REST route `/api/v1/testnet/transactions/{txid}` does answer
 * cleanly (200 / 404), but it is gated on the same ingestion, so it would
 * report "not found" for exactly as long — no earlier signal, and it would
 * need a proxy allowlist change. Confirmation therefore reads the accounts a
 * mutation writes instead; see `signAndSendInstruction`'s `isComplete`.
 */
const NOT_INDEXED_DETAIL = /invalid type: sequence, expected a string/i;

/**
 * True when an error means "that transaction is not visible yet" rather than
 * "your request was wrong" — however deeply it is wrapped.
 *
 * Every confirmation poll issued immediately after `send_transaction` lands in
 * the un-indexed window, so treating this as fatal reports healthy submissions
 * as failures. The transport turns it into `null` at the source, but the same
 * text also travels inside timeout messages and re-thrown wrappers, and one
 * layer of `new Error(other.message)` between here and the UI was enough to
 * turn it back into a hard failure. So the check walks `cause` chains and
 * matches the detail wherever it ended up, rather than trusting the error to
 * still be an `ArchRpcError` by the time anyone asks.
 *
 * The match stays narrow — this one upstream signature only — so a genuine
 * params-shape regression still raises.
 */
export function isTransactionNotIndexedError(error: unknown): boolean {
  let current: unknown = error;
  // Cause chains are short; the bound only stops a cyclic one from hanging.
  for (let depth = 0; current != null && depth < 8; depth += 1) {
    const candidate = current as { code?: unknown; data?: unknown; message?: unknown };
    if (
      candidate.code === -32602 &&
      typeof candidate.data === "string" &&
      NOT_INDEXED_DETAIL.test(candidate.data)
    ) {
      return true;
    }
    if (typeof candidate.message === "string" && NOT_INDEXED_DETAIL.test(candidate.message)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return typeof error === "string" && NOT_INDEXED_DETAIL.test(error);
}

/** Not-indexed, plus the "no such transaction" wordings validators use. */
function isTransactionUnavailableError(error: unknown): boolean {
  if (
    error instanceof ArchRpcError &&
    /transaction .*not found|not found in|no transaction/i.test(error.message)
  ) {
    return true;
  }
  return isTransactionNotIndexedError(error);
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
    throw new ArchRpcError(method, body.error);
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

function parseAccountPayload(
  result:
    | {
        data?: unknown;
        owner?: unknown;
        lamports?: number;
        is_executable?: boolean;
      }
    | null
    | undefined,
): AccountInfo | null {
  if (!result) return null;
  return {
    data: toBytes(result.data),
    owner: toBytes(result.owner),
    lamports: result.lamports ?? 0,
    isExecutable: Boolean(result.is_executable),
  };
}

function pubkeyCacheKey(pubkey: Uint8Array | string): string {
  return typeof pubkey === "string"
    ? pubkey.replace(/^0x/i, "").toLowerCase()
    : bytesToHex(pubkey);
}

/**
 * Direct Arch JSON-RPC transport for browsers and Node.
 * Works against endpoints that expose `read_account_info` / `send_transaction`.
 *
 * Every `params` shape comes from `archRpcParams`; see that module for the
 * method-by-method table verified against the live indexer.
 */
export function createArchRpcTransport(rpcUrl: string): AnsTransport {
  const accountCache = new Map<string, { expiresAt: number; value: AccountInfo | null }>();
  const inflightReads = new Map<string, Promise<AccountInfo | null>>();

  async function readAccountInfoUncached(
    pubkey: Uint8Array | string,
  ): Promise<AccountInfo | null> {
    try {
      const result = await rpc<{
        data?: unknown;
        owner?: unknown;
        lamports?: number;
        is_executable?: boolean;
      } | null>(rpcUrl, "read_account_info", archRpcParams.read_account_info(pubkey));
      return parseAccountPayload(result);
    } catch (error) {
      // Arch RPC returns a JSON-RPC error for missing accounts instead of null.
      if (error instanceof Error && isAccountMissingError(error.message)) {
        return null;
      }
      throw error;
    }
  }

  return {
    async readAccountInfo(pubkey) {
      const key = pubkeyCacheKey(pubkey);
      const cached = accountCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;

      const pending = inflightReads.get(key);
      if (pending) return pending;

      const request = readAccountInfoUncached(pubkey)
        .then((value) => {
          accountCache.set(key, { expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS, value });
          return value;
        })
        .finally(() => {
          inflightReads.delete(key);
        });
      inflightReads.set(key, request);
      return request;
    },

    async getMultipleAccounts(pubkeys) {
      if (pubkeys.length === 0) return [];
      const result = await rpc<
        Array<{
          data?: unknown;
          owner?: unknown;
          lamports?: number;
          is_executable?: boolean;
          key?: unknown;
        } | null>
      >(rpcUrl, "get_multiple_accounts", archRpcParams.get_multiple_accounts(pubkeys));

      const accounts = (result ?? []).map((entry) => parseAccountPayload(entry));
      // Pad/truncate to request length so callers can zip by index.
      while (accounts.length < pubkeys.length) accounts.push(null);
      const sliced = accounts.slice(0, pubkeys.length);

      const expiresAt = Date.now() + ACCOUNT_CACHE_TTL_MS;
      pubkeys.forEach((pubkey, index) => {
        accountCache.set(pubkeyCacheKey(pubkey), { expiresAt, value: sliced[index] ?? null });
      });
      return sliced;
    },

    async getProgramAccounts(programId, filters = []) {
      const result = await rpc<
        Array<{ pubkey?: unknown; account?: { data?: unknown; owner?: unknown; lamports?: number; is_executable?: boolean } }>
      >(
        rpcUrl,
        "get_program_accounts",
        archRpcParams.get_program_accounts(programId, filters),
      );
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
      // The indexer does not implement `get_slot` (-32601); block height is the
      // fallback. Kept in this order so a validator endpoint still gets a slot.
      try {
        const slot = await rpc<number | string>(rpcUrl, "get_slot", archRpcParams.get_slot());
        return BigInt(slot);
      } catch {
        const height = await rpc<number | string>(
          rpcUrl,
          "get_block_count",
          archRpcParams.get_block_count(),
        );
        return BigInt(height);
      }
    },

    async getBestBlockHash() {
      const hash = await rpc<string | number[]>(
        rpcUrl,
        "get_best_block_hash",
        archRpcParams.get_best_block_hash(),
      );
      return toBytes(hash);
    },

    async sendTransaction(transaction) {
      return rpc<string>(
        rpcUrl,
        "send_transaction",
        archRpcParams.send_transaction(transaction),
      );
    },

    async getProcessedTransaction(txid) {
      let result: { status?: unknown; error?: string } | null;
      try {
        result = await rpc<{ status?: unknown; error?: string } | null>(
          rpcUrl,
          "get_processed_transaction",
          archRpcParams.get_processed_transaction(txid),
        );
      } catch (error) {
        // Not indexed yet is not a failure; callers poll until it appears.
        if (isTransactionUnavailableError(error)) return null;
        throw error;
      }
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
        // The indexer reports `status: { type: "Processed" }`.
        if (typeof statusObj.type === "string") {
          return {
            status: statusObj.type,
            error: statusObj.type === "Failed" ? (result.error ?? "failed") : result.error,
          };
        }
      }
      return { status: String(result.status ?? "Unknown"), error: result.error };
    },
  };
}
