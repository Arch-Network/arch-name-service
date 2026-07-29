import { hexToBytes } from "../hex.js";

/**
 * The JSON-RPC `params` shape for every Arch method ANS calls.
 *
 * Verified empirically against the live testnet indexer behind
 * https://id.arch.network/rpc on 2026-07-28 by sending each candidate shape
 * and recording what the server accepted:
 *
 * | method                     | accepted `params`                   | rejected                                            |
 * | -------------------------- | ----------------------------------- | --------------------------------------------------- |
 * | read_account_info          | `[[b0..b31]]` (nested, 1 element)   | flat 32 bytes; bare `"<hex>"` ("missing `pubkey`")   |
 * | get_multiple_accounts      | `[[[b0..b31], [b0..b31], …]]`       | flat list of pubkeys (validator arch_sdk shape)     |
 * | get_program_accounts       | `[[b0..b31], filters]`              | flat program id                                     |
 * | create_account_with_faucet | `[b0..b31]` (FLAT, 32 elements)     | `[[b0..b31]]` ("expected u8"); `"<hex>"`; `{pubkey}` |
 * | send_transaction           | the RuntimeTransaction object       | `[tx]` ("invalid type: map, expected u32")           |
 * | get_processed_transaction  | `{ tx_id: "<64-char hex>" }`        | bare `"<hex>"` ("missing `tx_id`")                   |
 * | get_block_count            | `[]`                                | —                                                   |
 * | get_best_block_hash        | `[]`                                | —                                                   |
 * | get_slot                   | unsupported (-32601 Method not found) — callers fall back to `get_block_count` |
 *
 * The server is deliberately documented as *inconsistent*: `read_account_info`
 * requires the pubkey nested one level, while `create_account_with_faucet`
 * requires the same 32 bytes spread flat across `params`. That asymmetry is why
 * these shapes live in one module instead of at each call site — this repo has
 * previously flipped a call between flat and nested and shipped the wrong one.
 *
 * Where the server accepts more than one encoding (`read_account_info` and
 * `get_program_accounts` also take a hex string; `get_processed_transaction`
 * also takes `["<hex>"]`) ANS picks a single form and pins it with a payload
 * fixture in `tests/rpc-params.test.ts`.
 */

export type AccountFilter =
  | { DataSize: number }
  | { DataContent: { offset: number; bytes: number[] } };

/** The 32 pubkey bytes behind a hex string or byte array. */
function pubkeyBytes(pubkey: Uint8Array | string): number[] {
  const bytes =
    typeof pubkey === "string" ? hexToBytes(pubkey.replace(/^0x/i, "")) : pubkey;
  if (bytes.length !== 32) {
    throw new Error(`Arch pubkey must be 32 bytes, got ${bytes.length}`);
  }
  return Array.from(bytes);
}

/**
 * A txid in the 64-char lowercase hex form the indexer matches on.
 *
 * Checked here rather than at the server: a malformed txid otherwise comes
 * back as a generic `Invalid params`, indistinguishable from the request-shape
 * failures this module exists to rule out.
 */
function txidHex(txid: string): string {
  const normalized = txid.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Arch txid must be 64 hex characters, got "${txid}"`);
  }
  return normalized;
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

/**
 * `params` builders, one per method. Every ANS caller — SDK transport and the
 * manager's direct faucet `fetch` alike — must go through these.
 */
export const archRpcParams = {
  /** Nested: the 32 bytes are `params[0]`, not `params`. */
  read_account_info(pubkey: Uint8Array | string): [number[]] {
    return [pubkeyBytes(pubkey)];
  },

  /**
   * Indexer wants the pubkey list nested one level: `params[0] = pubkeys[]`.
   * The validator/arch_sdk flat `params = pubkeys` returns -32602 on
   * id.arch.network/rpc (probed 2026-07-29).
   */
  get_multiple_accounts(pubkeys: Array<Uint8Array | string>): [number[][]] {
    return [pubkeys.map((pubkey) => pubkeyBytes(pubkey))];
  },

  get_program_accounts(
    programId: Uint8Array | string,
    filters: AccountFilter[] = [],
  ): [number[], AccountFilter[]] {
    return [pubkeyBytes(programId), filters];
  },

  /** Flat: the 32 bytes *are* `params`. Nesting them returns -32602. */
  create_account_with_faucet(pubkey: Uint8Array | string): number[] {
    return pubkeyBytes(pubkey);
  },

  /** The transaction object itself is `params`; wrapping it returns -32602. */
  send_transaction(transaction: unknown): ReturnType<typeof normalizeRuntimeTransaction> {
    return normalizeRuntimeTransaction(transaction);
  },

  get_processed_transaction(txid: string): { tx_id: string } {
    return { tx_id: txidHex(txid) };
  },

  get_block_count(): [] {
    return [];
  },

  get_best_block_hash(): [] {
    return [];
  },

  get_slot(): [] {
    return [];
  },
} as const;
