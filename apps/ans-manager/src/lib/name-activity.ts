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
import {
  ansInstructionPayloads,
  explorerBlockHeight,
  explorerCreatedAt,
  fetchTransactionRows,
  isFailedStatus,
  type ExplorerTxRow,
} from "./explorer-tx";

export { isFailedStatus };

export type NameActivityItem = {
  txid: string;
  createdAt: string | null;
  blockHeight: number | null;
  /** Decoded ANS action from the v2 instruction payload. */
  action?: ActivityAction | null;
  failed?: boolean;
};

export function actionFromExplorerRow(
  row: ExplorerTxRow,
  programIdHex: string,
): ActivityAction | null {
  for (const payload of ansInstructionPayloads(row, programIdHex)) {
    const action = describeInstructionData(payload);
    if (action) return action;
  }
  return null;
}

function asActivityItem(
  row: ExplorerTxRow,
  programIdHex: string,
): NameActivityItem | null {
  if (typeof row.txid !== "string" || !row.txid) return null;
  return {
    txid: row.txid,
    createdAt: explorerCreatedAt(row),
    blockHeight: explorerBlockHeight(row),
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
  const rows = await fetchTransactionRows(address, {
    limit,
    context: "name activity",
  });
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
