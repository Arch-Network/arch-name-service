/**
 * Program-wide ANS event feed, used wherever the UI needs chronological order.
 *
 * The registry program stamps `registered_at_slot: 0` on every name (and
 * `created_at_slot: 0` on every listing), so the accounts themselves carry no
 * usable ordering — sorting by those fields degenerates to a tie-break and new
 * registrations never surface. The Explorer's program-scoped transaction feed
 * does carry order: newest first, with real timestamps and the full instruction
 * payload, so registration and listing recency are derived from it here.
 *
 * Coverage is bounded by how many pages we pull, which is fine for "latest N"
 * but means older names have no timestamp. Callers must treat a missing
 * timestamp as "unknown, sort last" rather than "oldest".
 */

import {
  bytesToHex,
  canonicalizeName,
  loadTestnetManifest,
} from "@arch-network/ans-sdk";
import { decodeArchAddress, encodeArchAddress } from "./ans";
import {
  decodeAnsInstructions,
  explorerCreatedAt,
  fetchTransactionRows,
  isFailedStatus,
} from "./explorer-tx";

export type RegistrationEvent = {
  /** Canonical `<label>.arch`. */
  name: string;
  txid: string;
  createdAt: string | null;
  /** Epoch ms, or null when the row carried no parseable timestamp. */
  at: number | null;
};

export type RegistryTimeline = {
  /** Newest first, one entry per name. */
  registrations: RegistrationEvent[];
  /** Canonical name -> epoch ms of its registration. */
  registeredAtByName: Map<string, number>;
  /** Hex name hash -> epoch ms of its newest `ListName`. */
  listedAtByNameHash: Map<string, number>;
};

/** Two pages (200 txs) covers days of testnet activity; enough for recency. */
const DEFAULT_PAGES = 2;
const PAGE_SIZE = 100;

function toEpochMs(createdAt: string | null): number | null {
  if (!createdAt) return null;
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The ANS program account, base58, as the Explorer addresses it. */
export function programAccountAddress(): string {
  return encodeArchAddress(decodeArchAddress(loadTestnetManifest().programId));
}

export const EMPTY_REGISTRY_TIMELINE: RegistryTimeline = {
  registrations: [],
  registeredAtByName: new Map(),
  listedAtByNameHash: new Map(),
};

/**
 * Registration and listing recency for the whole registry.
 *
 * Failed transactions are skipped: a rejected register never created a name, so
 * letting it set the order would show a name that does not exist.
 */
export async function fetchRegistryTimeline(
  opts: { pages?: number } = {},
): Promise<RegistryTimeline> {
  const pages = Math.max(1, Math.floor(opts.pages ?? DEFAULT_PAGES));
  const address = programAccountAddress();
  const programIdHex = loadTestnetManifest().programId.toLowerCase();

  const registrations: RegistrationEvent[] = [];
  const registeredAtByName = new Map<string, number>();
  const listedAtByNameHash = new Map<string, number>();
  const seenNames = new Set<string>();

  for (let page = 1; page <= pages; page++) {
    const rows = await fetchTransactionRows(address, {
      limit: PAGE_SIZE,
      page,
      context: "registry activity",
    });
    for (const row of rows) {
      if (isFailedStatus(row.status)) continue;
      const txid = typeof row.txid === "string" ? row.txid : "";
      if (!txid) continue;
      const createdAt = explorerCreatedAt(row);
      const at = toEpochMs(createdAt);
      for (const ix of decodeAnsInstructions(row, programIdHex)) {
        // ReclaimExpired re-registers a lapsed name, so it starts a new tenure.
        if (ix.kind === "Register" || ix.kind === "ReclaimExpired") {
          const name = canonicalizeName(`${ix.label}.arch`);
          // Rows arrive newest first, so the first sighting is the current one.
          if (seenNames.has(name)) continue;
          seenNames.add(name);
          registrations.push({ name, txid, createdAt, at });
          if (at !== null) registeredAtByName.set(name, at);
        } else if (ix.kind === "ListName") {
          const key = bytesToHex(ix.nameHash);
          if (at !== null && !listedAtByNameHash.has(key)) {
            listedAtByNameHash.set(key, at);
          }
        }
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }

  return { registrations, registeredAtByName, listedAtByNameHash };
}

/**
 * Order on-chain names by known registration time, newest first.
 *
 * Names the Explorer window does not reach have no timestamp; they sort after
 * every dated name (reverse-alphabetically among themselves, matching the SDK's
 * slot-tie fallback) rather than being treated as the oldest or the newest.
 */
export function orderNamesByRegistration<T extends { name: string }>(
  onChain: ReadonlyArray<T>,
  registeredAtByName: ReadonlyMap<string, number>,
  limit: number,
): T[] {
  const capped = Math.max(0, Math.floor(limit));
  return [...onChain]
    .sort((a, b) => {
      const aAt = registeredAtByName.get(a.name);
      const bAt = registeredAtByName.get(b.name);
      if (aAt !== undefined && bAt !== undefined) {
        return bAt !== aAt ? bAt - aAt : a.name.localeCompare(b.name);
      }
      if (aAt !== undefined) return -1;
      if (bAt !== undefined) return 1;
      return a.name > b.name ? -1 : a.name < b.name ? 1 : 0;
    })
    .slice(0, capped);
}

/** Newest registrations first, capped. */
export async function fetchRecentRegistrations(
  limit = 12,
  opts: { pages?: number } = {},
): Promise<RegistrationEvent[]> {
  const capped = Math.max(0, Math.floor(limit));
  if (capped === 0) return [];
  const timeline = await fetchRegistryTimeline(opts);
  return timeline.registrations.slice(0, capped);
}
