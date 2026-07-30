import { hexToBytes } from "../hex.js";
import type { ProcessedTransaction } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 3;

export type ExplorerRestTransport = {
  getCurrentSlot(): Promise<bigint>;
  getBestBlockHash(): Promise<Uint8Array>;
  getProcessedTransaction(txid: string): Promise<ProcessedTransaction | null>;
};

export type ExplorerRestOptions = {
  timeoutMs?: number;
  retries?: number;
  fetch?: typeof globalThis.fetch;
};

type FetchFn = typeof globalThis.fetch;

/**
 * `window.fetch` is a method of the global and rejects any other receiver with
 * `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`.
 * Storing it on an options object and calling `options.fetch(...)` supplies
 * that object as the receiver, which broke every Explorer REST read in the
 * browser while passing under a `vi.fn()` mock that ignores `this`. Bind once
 * here so no call site can reintroduce it.
 */
function bindFetch(fetchImpl: FetchFn): FetchFn {
  return (input, init) => fetchImpl.call(globalThis, input, init);
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function retryDelayMs(attempt: number, response?: Response): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return Math.min(Number(retryAfter) * 1_000, 5_000);
  }
  return Math.min(250 * 2 ** attempt, 2_000);
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: Required<Pick<ExplorerRestOptions, "timeoutMs" | "retries">> & {
    fetch: FetchFn;
  },
): Promise<T | null> {
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await options.fetch(joinUrl(baseUrl, path), {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      if (attempt >= options.retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 404) return null;
    if ((response.status === 429 || response.status >= 500) && attempt < options.retries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, response)));
      continue;
    }
    if (!response.ok) {
      throw new Error(`Explorer REST HTTP ${response.status} for ${path}`);
    }
    return (await response.json()) as T;
  }
}

function transactionStatus(body: Record<string, unknown>): ProcessedTransaction {
  const raw = body.status;
  if (typeof raw === "string") {
    const failed = /fail|error|rollback/i.test(raw);
    return {
      status: failed ? "Failed" : raw,
      error: failed ? String(body.error ?? body.logs ?? raw) : undefined,
    };
  }
  if (raw && typeof raw === "object") {
    const status = raw as Record<string, unknown>;
    const type = typeof status.type === "string" ? status.type : Object.keys(status)[0];
    const failed = /fail|error|rollback/i.test(type ?? "");
    return {
      status: failed ? "Failed" : (type ?? "Unknown"),
      error: failed ? String(status.error ?? status.Failed ?? body.error ?? type) : undefined,
    };
  }
  return { status: "Unknown" };
}

/**
 * Explorer's native read API. The base URL is expected to be a same-origin
 * authenticated proxy such as `/explorer`; no API-key header is accepted here.
 */
export function createExplorerRestTransport(
  baseUrl: string,
  options: ExplorerRestOptions = {},
): ExplorerRestTransport {
  const requestOptions = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: options.retries ?? DEFAULT_RETRIES,
    fetch: bindFetch(options.fetch ?? globalThis.fetch),
  };

  return {
    async getCurrentSlot() {
      const body = await requestJson<Record<string, unknown>>(
        baseUrl,
        "network/stats",
        requestOptions,
      );
      const value = body?.slot_height ?? body?.latest_block_height ?? body?.indexed_height;
      if (typeof value !== "number" && typeof value !== "string") {
        throw new Error("Explorer network stats did not include a chain height");
      }
      return BigInt(value);
    },

    async getBestBlockHash() {
      const body = await requestJson<{ blocks?: Array<{ hash?: unknown }> }>(
        baseUrl,
        "blocks?limit=1",
        requestOptions,
      );
      const hash = body?.blocks?.[0]?.hash;
      if (typeof hash !== "string") {
        throw new Error("Explorer blocks response did not include the latest hash");
      }
      return hexToBytes(hash);
    },

    async getProcessedTransaction(txid) {
      const normalized = txid.replace(/^0x/i, "").toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalized)) {
        throw new Error("Transaction ID must be 32 bytes of hex");
      }
      const body = await requestJson<Record<string, unknown>>(
        baseUrl,
        `transactions/${normalized}`,
        requestOptions,
      );
      return body ? transactionStatus(body) : null;
    },
  };
}
