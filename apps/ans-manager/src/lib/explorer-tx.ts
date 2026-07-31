/**
 * Shared plumbing for the Explorer's `/transactions/v2` rows.
 *
 * Both the per-name activity feed and the program-wide registry feed read the
 * same row shape, so the base URL, field coercion and ANS instruction
 * extraction live here rather than being duplicated per consumer.
 */

import {
  decodeInstruction,
  hexToBytes,
  type NameInstruction,
} from "@arch-network/ans-sdk";

export const EXPLORER_BASE = (import.meta.env.VITE_EXPLORER_URL ?? "/explorer").replace(
  /\/+$/,
  "",
);

/** Explorer caps a page at 100 rows. */
const MAX_PAGE_SIZE = 100;

export type ExplorerInstruction = { program_id?: unknown; data?: unknown };

export type ExplorerTxRow = {
  txid?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  block_height?: unknown;
  blockHeight?: unknown;
  status?: unknown;
  data?: { message?: { instructions?: unknown } };
};

/** The Explorer reports failures as `{ Failed: reason }` and successes as a string. */
export function isFailedStatus(status: unknown): boolean {
  if (typeof status === "string") return status.toLowerCase() === "failed";
  return typeof status === "object" && status !== null && "Failed" in status;
}

export function explorerCreatedAt(row: ExplorerTxRow): string | null {
  if (typeof row.created_at === "string") return row.created_at;
  if (typeof row.createdAt === "string") return row.createdAt;
  return null;
}

export function explorerBlockHeight(row: ExplorerTxRow): number | null {
  const raw = row.block_height ?? row.blockHeight;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && /^-?\d+$/.test(raw)) return Number(raw);
  return null;
}

/** Hex instruction payloads in this row that target `programIdHex`. */
export function ansInstructionPayloads(
  row: ExplorerTxRow,
  programIdHex: string,
): string[] {
  const raw = row.data?.message?.instructions;
  const instructions = Array.isArray(raw) ? (raw as ExplorerInstruction[]) : [];
  const wanted = programIdHex.toLowerCase();
  const out: string[] = [];
  for (const ix of instructions) {
    if (typeof ix.program_id !== "string" || ix.program_id.toLowerCase() !== wanted) {
      continue;
    }
    if (typeof ix.data === "string") out.push(ix.data);
  }
  return out;
}

/** Decoded ANS instructions in this row; non-ANS payloads are skipped. */
export function decodeAnsInstructions(
  row: ExplorerTxRow,
  programIdHex: string,
): NameInstruction[] {
  const out: NameInstruction[] = [];
  for (const payload of ansInstructionPayloads(row, programIdHex)) {
    try {
      out.push(decodeInstruction(hexToBytes(payload)));
    } catch {
      // Not an ANS instruction (or a newer encoding this build cannot read).
    }
  }
  return out;
}

/**
 * One page of transactions touching `address`, newest first.
 *
 * Path is relative to /explorer (the proxy already targets /api/v1/testnet).
 * Do not prefix with "testnet/" — that fails the proxy allowlist.
 */
export async function fetchTransactionRows(
  address: string,
  opts: { limit?: number; page?: number; context?: string } = {},
): Promise<ExplorerTxRow[]> {
  if (!address) return [];
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 50)), MAX_PAGE_SIZE);
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const query = new URLSearchParams({ limit: String(limit) });
  if (page > 1) query.set("page", String(page));
  const url = `${EXPLORER_BASE}/accounts/${encodeURIComponent(address)}/transactions/v2?${query}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(
      `Explorer ${opts.context ?? "transactions"} HTTP ${response.status}`,
    );
  }
  const body = (await response.json()) as { transactions?: ExplorerTxRow[] };
  return Array.isArray(body.transactions) ? body.transactions : [];
}
