/**
 * Recent on-chain activity for a name PDA, via same-origin Explorer REST.
 *
 * Uses `/accounts/{addr}/transactions/v2`, which includes instruction data and
 * status so each row can be labeled without a follow-up detail fetch.
 */

import {
  canonicalizeName,
  deriveNameAddress,
  loadTestnetManifest,
  nameHash,
} from "@arch-network/ans-sdk";
import { describeInstructionData, type ActivityAction } from "./activity-labels";
import { decodeArchAddress, encodeArchAddress, getAnsClient } from "./ans";

const EXPLORER_BASE = (import.meta.env.VITE_EXPLORER_URL ?? "/explorer").replace(
  /\/+$/,
  "",
);

export type NameActivityItem = {
  txid: string;
  createdAt: string | null;
  blockHeight: number | null;
  /** Decoded ANS action from the v2 instruction payload. */
  action?: ActivityAction | null;
  failed?: boolean;
};

type ExplorerInstruction = { program_id?: unknown; data?: unknown };

type ExplorerTxRow = {
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

export function actionFromExplorerRow(
  row: ExplorerTxRow,
  programIdHex: string,
): ActivityAction | null {
  const raw = row.data?.message?.instructions;
  const instructions = Array.isArray(raw) ? (raw as ExplorerInstruction[]) : [];
  for (const ix of instructions) {
    if (
      typeof ix.program_id !== "string" ||
      ix.program_id.toLowerCase() !== programIdHex.toLowerCase() ||
      typeof ix.data !== "string"
    ) {
      continue;
    }
    const action = describeInstructionData(ix.data);
    if (action) return action;
  }
  return null;
}

function asActivityItem(
  row: ExplorerTxRow,
  programIdHex: string,
): NameActivityItem | null {
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
  return {
    txid: row.txid,
    createdAt,
    blockHeight,
    action: actionFromExplorerRow(row, programIdHex),
    failed: isFailedStatus(row.status),
  };
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
  // Path is relative to /explorer (proxy already targets /api/v1/testnet).
  // Do not prefix with "testnet/" — that fails the proxy allowlist.
  const url = `${EXPLORER_BASE}/accounts/${encodeURIComponent(address)}/transactions/v2?limit=${capped}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`Explorer name activity HTTP ${response.status}`);
  }
  const body = (await response.json()) as { transactions?: ExplorerTxRow[] };
  const rows = Array.isArray(body.transactions) ? body.transactions : [];
  // Manifest programId is already hex — avoid constructing AnsClient just to label rows.
  const programIdHex = loadTestnetManifest().programId.toLowerCase();
  return rows
    .map((row) => asActivityItem(row, programIdHex))
    .filter((row): row is NameActivityItem => row !== null);
}

export async function fetchActivityForName(
  canonicalName: string,
  limit = 50,
): Promise<NameActivityItem[]> {
  return fetchNameActivity(nameAccountAddressFor(canonicalName), limit);
}
