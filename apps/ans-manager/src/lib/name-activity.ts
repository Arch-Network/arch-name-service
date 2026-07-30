/**
 * Recent on-chain activity for a name PDA, via same-origin Explorer REST.
 */

import {
  bytesToHex,
  canonicalizeName,
  deriveNameAddress,
  nameHash,
} from "@arch-network/ans-sdk";
import { describeInstructionData, type ActivityAction } from "./activity-labels";
import { decodeArchAddress, encodeArchAddress, getAnsClient } from "./ans";

const EXPLORER_BASE = (import.meta.env.VITE_EXPLORER_URL ?? "/explorer").replace(
  /\/+$/,
  "",
);

/** How many rows get a follow-up detail fetch to resolve their action. */
const ACTION_LOOKUP_LIMIT = 25;
const ACTION_LOOKUP_CONCURRENCY = 6;

export type NameActivityItem = {
  txid: string;
  createdAt: string | null;
  blockHeight: number | null;
  /** Decoded ANS action, present once the transaction detail has been read. */
  action?: ActivityAction | null;
  failed?: boolean;
};

type ExplorerTxRow = {
  txid?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  block_height?: unknown;
  blockHeight?: unknown;
};

function asActivityItem(row: ExplorerTxRow): NameActivityItem | null {
  if (typeof row.txid !== "string" || !row.txid) return null;
  const createdAt =
    typeof row.created_at === "string"
      ? row.created_at
      : typeof row.createdAt === "string"
        ? row.createdAt
        : null;
  const blockHeightRaw = row.block_height ?? row.blockHeight;
  const blockHeight =
    typeof blockHeightRaw === "number" && Number.isFinite(blockHeightRaw)
      ? blockHeightRaw
      : typeof blockHeightRaw === "string" && /^-?\d+$/.test(blockHeightRaw)
        ? Number(blockHeightRaw)
        : null;
  return { txid: row.txid, createdAt, blockHeight };
}

/** Normalize a name PDA address (base58 or 64-char hex) to base58 for Explorer. */
export function normalizeNameAccountAddress(nameAccountBase58OrHex: string): string {
  return encodeArchAddress(decodeArchAddress(nameAccountBase58OrHex.trim()));
}

/** Derive the name PDA as base58 via the live ANS client. */
export function nameAccountAddressFor(name: string): string {
  const client = getAnsClient();
  const hash = nameHash(canonicalizeName(name));
  return encodeArchAddress(
    deriveNameAddress(client.programId, client.manifest.namespace, hash),
  );
}

/**
 * Recent transactions touching a name account PDA.
 *
 * `nameAccountBase58OrHex` is the name PDA (not the human `.arch` label).
 * Use {@link nameAccountAddressFor} when you only have the name string.
 */
export async function fetchNameActivity(
  nameAccountBase58OrHex: string,
  limit = 50,
): Promise<NameActivityItem[]> {
  const address = normalizeNameAccountAddress(nameAccountBase58OrHex);
  if (!address) return [];
  const capped = Math.min(Math.max(1, Math.floor(limit)), 100);
  const url = `${EXPLORER_BASE}/accounts/${encodeURIComponent(address)}/transactions?limit=${capped}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`Explorer name activity HTTP ${response.status}`);
  }
  const body = (await response.json()) as { transactions?: ExplorerTxRow[] };
  const rows = Array.isArray(body.transactions) ? body.transactions : [];
  return rows
    .map(asActivityItem)
    .filter((row): row is NameActivityItem => row !== null);
}

type ExplorerInstruction = { program_id?: unknown; data?: unknown };

type ExplorerTxDetail = {
  status?: unknown;
  data?: { message?: { instructions?: unknown } };
};

/** The Explorer reports failures as `{ Failed: reason }` and successes as a string. */
function isFailedStatus(status: unknown): boolean {
  if (typeof status === "string") return status.toLowerCase() === "failed";
  return typeof status === "object" && status !== null && "Failed" in status;
}

function actionFromDetail(
  detail: ExplorerTxDetail,
  programIdHex: string,
): ActivityAction | null {
  const raw = detail.data?.message?.instructions;
  const instructions = Array.isArray(raw) ? (raw as ExplorerInstruction[]) : [];
  for (const ix of instructions) {
    if (ix.program_id !== programIdHex || typeof ix.data !== "string") continue;
    const action = describeInstructionData(ix.data);
    if (action) return action;
  }
  return null;
}

/** Action and failure state for one txid; nulls out on any Explorer or decode gap. */
async function fetchTxAction(
  txid: string,
  programIdHex: string,
): Promise<Pick<NameActivityItem, "action" | "failed">> {
  try {
    const response = await fetch(
      `${EXPLORER_BASE}/transactions/${encodeURIComponent(txid)}`,
      { headers: { accept: "application/json" } },
    );
    if (!response.ok) return { action: null, failed: false };
    const detail = (await response.json()) as ExplorerTxDetail;
    return {
      action: actionFromDetail(detail, programIdHex),
      failed: isFailedStatus(detail.status),
    };
  } catch {
    return { action: null, failed: false };
  }
}

async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index]!);
      }
    }),
  );
  return results;
}

/** Attach decoded ANS actions to the most recent rows. */
export async function enrichNameActivity(
  items: ReadonlyArray<NameActivityItem>,
): Promise<NameActivityItem[]> {
  const head = items.slice(0, ACTION_LOOKUP_LIMIT);
  const programIdHex = bytesToHex(getAnsClient().programId);
  const actions = await mapWithConcurrency(head, ACTION_LOOKUP_CONCURRENCY, (row) =>
    fetchTxAction(row.txid, programIdHex),
  );
  return items.map((row, index) =>
    index < actions.length ? { ...row, ...actions[index]! } : row,
  );
}

export async function fetchActivityForName(
  canonicalName: string,
  limit = 50,
): Promise<NameActivityItem[]> {
  const rows = await fetchNameActivity(nameAccountAddressFor(canonicalName), limit);
  return enrichNameActivity(rows);
}
