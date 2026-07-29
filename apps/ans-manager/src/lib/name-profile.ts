/**
 * Batched ANS profile loads for Manage / Search.
 *
 * One `get_multiple_accounts` round trip replaces ~20× `read_account_info`
 * catalog fan-out. A short in-memory cache + in-flight dedupe keeps Strict Mode
 * remounts and focus churn from repeating the work.
 */

import {
  TEXT_RECORD_CATALOG,
  encodeTaprootAddress,
  type RecordAccount,
} from "@arch-network/ans-sdk";
import { ansClient, decodeArchAddress, encodeArchAddress } from "./ans";

export type LoadedProfile = {
  ownerDisplay: string | null;
  primaryName: string | null;
  archOwnerRevision: bigint;
  taprootRevision: bigint;
  taprootDisplay: string | null;
  textByKey: Record<string, { revision: bigint; value: string } | null>;
};

type CacheEntry = {
  expiresAt: number;
  profile: LoadedProfile | null;
  /** Registered-but-empty vs not registered — callers need the error string. */
  error: string | null;
};

const PROFILE_TTL_MS = 15_000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function cacheKey(canonicalName: string, ownerArchAddress: string | null): string {
  return `${canonicalName}|${ownerArchAddress ?? ""}`;
}

function textFromRecord(
  record: RecordAccount | null,
): { revision: bigint; value: string } | null {
  if (record?.value.kind === "Text") {
    return { revision: record.revision, value: record.value.value };
  }
  return null;
}

function taprootDisplayFrom(record: RecordAccount | null): string | null {
  if (record?.value.kind !== "BitcoinTaproot") return null;
  try {
    return encodeTaprootAddress(record.value.witnessProgram, "testnet");
  } catch {
    return null;
  }
}

async function loadProfileUncached(
  canonicalName: string,
  ownerArchAddress: string | null,
): Promise<CacheEntry> {
  const primaryOwner = ownerArchAddress
    ? decodeArchAddress(ownerArchAddress)
    : undefined;
  const result = await ansClient.fetchNameProfile(canonicalName, {
    textKeys: TEXT_RECORD_CATALOG.map((spec) => spec.key),
    primaryOwner,
  });

  if (!result.nameAccount) {
    return {
      expiresAt: Date.now() + PROFILE_TTL_MS,
      profile: null,
      error: `${canonicalName} is not registered.`,
    };
  }

  const textByKey: LoadedProfile["textByKey"] = {};
  for (const spec of TEXT_RECORD_CATALOG) {
    textByKey[spec.key] = textFromRecord(result.textByKey[spec.key] ?? null);
  }

  return {
    expiresAt: Date.now() + PROFILE_TTL_MS,
    error: null,
    profile: {
      ownerDisplay: encodeArchAddress(result.nameAccount.owner),
      primaryName: result.primaryName,
      archOwnerRevision: result.archOwner?.revision ?? 0n,
      taprootRevision: result.taproot?.revision ?? 0n,
      taprootDisplay: taprootDisplayFrom(result.taproot),
      textByKey,
    },
  };
}

/**
 * Load the Manage/Search resolution profile for a canonical name.
 * Pass `ownerArchAddress` when the connected wallet's primary binding matters.
 */
export async function loadNameProfile(
  canonicalName: string,
  ownerArchAddress: string | null = null,
): Promise<{ profile: LoadedProfile | null; error: string | null }> {
  const key = cacheKey(canonicalName, ownerArchAddress);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { profile: hit.profile, error: hit.error };
  }

  const pending = inflight.get(key);
  if (pending) {
    const entry = await pending;
    return { profile: entry.profile, error: entry.error };
  }

  const request = loadProfileUncached(canonicalName, ownerArchAddress)
    .then((entry) => {
      cache.set(key, entry);
      return entry;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  const entry = await request;
  return { profile: entry.profile, error: entry.error };
}

/** Drop cached profiles after a successful mutation so the next load is fresh. */
export function invalidateNameProfile(canonicalName?: string | null): void {
  if (!canonicalName) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${canonicalName}|`)) cache.delete(key);
  }
}
