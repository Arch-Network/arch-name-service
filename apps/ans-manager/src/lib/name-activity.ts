/**
 * Recent on-chain activity for a name PDA, via same-origin Explorer REST.
 */

import { canonicalizeName, deriveNameAddress, nameHash } from "@arch-network/ans-sdk";
import { decodeArchAddress, encodeArchAddress, getAnsClient } from "./ans";

const EXPLORER_BASE = (import.meta.env.VITE_EXPLORER_URL ?? "/explorer").replace(
  /\/+$/,
  "",
);

export type NameActivityItem = {
  txid: string;
  createdAt: string | null;
  blockHeight: number | null;
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

export async function fetchActivityForName(
  canonicalName: string,
  limit = 50,
): Promise<NameActivityItem[]> {
  return fetchNameActivity(nameAccountAddressFor(canonicalName), limit);
}
