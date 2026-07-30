/**
 * Which .arch names this wallet owns — across every account it has told
 * this site about, not just the one it is reporting right now.
 *
 * Why that distinction exists: the released extension answers
 * `getAccount()` from the origin binding but signs with the wallet's
 * globally *active* account, so a registration lands on the account that
 * signed, which is not necessarily the account the header chip shows.
 * "My names", filtered to the reported account alone, then tells a user
 * who owns four names that they own none — the page is technically
 * describing one account and the user is asking about their wallet.
 *
 * So the lookup runs over the reported account plus every other account
 * the wallet has reported here (`signer-registry`, which is also the
 * candidate set signature identification uses). Nothing is invented: an
 * account is only queried because the extension named it at some point.
 *
 * Each account is read independently and carries its own failure. A
 * lookup that throws must never collapse into "no names" — that is the
 * one outcome indistinguishable from the truth, and the reason this
 * returns a per-account status instead of a flat list.
 */

import type { RecordType } from "@arch-network/ans-sdk";
import bs58 from "bs58";
import { archIdentitiesEqual, canonicalArchKey } from "./arch-identity";
import { signerCandidates } from "./signer-registry";

/** Records "My names" reports health for. */
const SUMMARY_RECORDS: RecordType[] = ["ArchOwner", "BitcoinTaproot"];

export type OwnedName = {
  name: string;
  /** Owner as it reads on-chain, for display and Explorer links. */
  ownerArchAddress: string;
  /** `null` when the record lookups failed — unknown, not zero. */
  recordCount: number | null;
};

export type AccountNames = {
  /** The address in the encoding the wallet reported it in. */
  archAddress: string;
  /** True for the account the extension is reporting to this site now. */
  connected: boolean;
  names: OwnedName[];
  /** Primary identity, or null when unset or unreadable. */
  primary: string | null;
  /** Set when this account's name lookup failed; `names` is then empty and meaningless. */
  error: Error | null;
};

export type OwnedNamesResult = {
  /** Connected account first, then other accounts the wallet has reported. */
  accounts: AccountNames[];
  /** True when any account's lookup failed — the page must say so. */
  failed: boolean;
};

/**
 * The reads this module needs, narrowed so tests can supply them without
 * an RPC endpoint or a full `AnsClient`.
 */
export type OwnedNamesReader = {
  listOwnedNames(owner: Uint8Array): Promise<Array<{ name: string; account: { owner: Uint8Array } }>>;
  fetchRecord(name: string, recordType: RecordType): Promise<unknown>;
  resolvePrimary(owner: Uint8Array): Promise<string | null>;
};

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value ?? "Unknown error"));
}

/**
 * Every account worth querying, most relevant first, canonically deduped.
 *
 * `signerCandidates` already answers "other keys this browser has watched
 * the wallet report", newest first with the observed signer promoted, so
 * the candidate set is not re-derived here.
 */
export function nameLookupAccounts(connectedArchAddress: string | null): string[] {
  if (!connectedArchAddress) return [];
  return [connectedArchAddress, ...signerCandidates(connectedArchAddress, [])].filter(
    (candidate, index, all) =>
      all.findIndex((other) => archIdentitiesEqual(other, candidate)) === index,
  );
}

async function countRecords(
  reader: OwnedNamesReader,
  name: string,
): Promise<number | null> {
  try {
    const found = await Promise.all(
      SUMMARY_RECORDS.map((recordType) => reader.fetchRecord(name, recordType)),
    );
    return found.filter(Boolean).length;
  } catch {
    // Record health is a nicety; losing it must not lose the name.
    return null;
  }
}

async function loadForAccount(
  reader: OwnedNamesReader,
  archAddress: string,
  connected: boolean,
): Promise<AccountNames> {
  const key = canonicalArchKey(archAddress);
  if (!key) {
    return {
      archAddress,
      connected,
      names: [],
      primary: null,
      error: new Error(
        `Arch Wallet reported an address this app cannot read as an account key: ${archAddress}`,
      ),
    };
  }

  let owned: Array<{ name: string; account: { owner: Uint8Array } }>;
  try {
    owned = await reader.listOwnedNames(key);
  } catch (error) {
    return { archAddress, connected, names: [], primary: null, error: toError(error) };
  }

  const names = await Promise.all(
    owned.map(async (entry) => ({
      name: entry.name,
      ownerArchAddress: bs58.encode(entry.account.owner),
      recordCount: await countRecords(reader, entry.name),
    })),
  );

  // An unset primary and an unreadable one are both "nothing to show";
  // neither is worth failing an otherwise complete list over.
  let primary: string | null = null;
  try {
    primary = await reader.resolvePrimary(key);
  } catch {
    primary = null;
  }

  return { archAddress, connected, names, primary, error: null };
}

/**
 * Read owned names for the reported account and every other account this
 * wallet has named here.
 *
 * Accounts are queried in parallel and reported in order, each with its
 * own error, so a partial failure renders as "some of this failed" rather
 * than as an empty wallet.
 */
export async function loadOwnedNames(
  reader: OwnedNamesReader,
  connectedArchAddress: string,
): Promise<OwnedNamesResult> {
  const candidates = nameLookupAccounts(connectedArchAddress);
  const accounts = await Promise.all(
    candidates.map((archAddress, index) =>
      loadForAccount(reader, archAddress, index === 0),
    ),
  );
  return { accounts, failed: accounts.some((entry) => entry.error !== null) };
}

/** Names on the reported account. Empty is only meaningful when it did not fail. */
export function connectedAccountNames(result: OwnedNamesResult): AccountNames | null {
  return result.accounts.find((entry) => entry.connected) ?? null;
}

/** Accounts other than the reported one that actually own something. */
export function otherAccountNames(result: OwnedNamesResult): AccountNames[] {
  return result.accounts.filter((entry) => !entry.connected && entry.names.length > 0);
}

export function totalNameCount(result: OwnedNamesResult): number {
  return result.accounts.reduce((sum, entry) => sum + entry.names.length, 0);
}

/** The first failure worth showing, connected account preferred. */
export function firstLookupError(result: OwnedNamesResult): Error | null {
  const connected = connectedAccountNames(result);
  if (connected?.error) return connected.error;
  return result.accounts.find((entry) => entry.error)?.error ?? null;
}
