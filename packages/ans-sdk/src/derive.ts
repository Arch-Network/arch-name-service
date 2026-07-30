import { PubkeyUtil } from "@saturnbtcio/arch-sdk";

import {
  CONFIG_SEED,
  LISTING_SEED,
  NAME_SEED,
  OFFER_SEED,
  RECORD_SEED,
  REVERSE_SEED,
} from "./constants.js";
import { namespaceHash, recordKeyHash } from "./hash.js";
import type { ArchAddress, RecordType } from "./types.js";

function encodeU32LE(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function recordTypeByte(recordType: RecordType): number {
  switch (recordType) {
    case "ArchOwner":
      return 0;
    case "BitcoinTaproot":
      return 1;
    case "TokenAta":
      return 2;
    case "Text":
      return 3;
  }
}

function asBytes(value: Uint8Array): Uint8Array {
  // Copy into a fresh Uint8Array so Node Buffers / cross-realm views
  // satisfy @noble/hashes' strict byte checks inside arch-sdk PDA helpers.
  return Uint8Array.from(value);
}

function derive(programId: ArchAddress, seeds: Uint8Array[]): ArchAddress {
  return PubkeyUtil.findProgramAddress(
    seeds.map(asBytes),
    asBytes(programId),
  )[0];
}

export function deriveConfigAddress(
  programId: ArchAddress,
  networkId: number,
  namespace: string,
): ArchAddress {
  return derive(programId, [
    CONFIG_SEED,
    encodeU32LE(networkId),
    namespaceHash(namespace),
  ]);
}

export function deriveNameAddress(
  programId: ArchAddress,
  namespace: string,
  nameHashBytes: Uint8Array,
): ArchAddress {
  return derive(programId, [NAME_SEED, namespaceHash(namespace), nameHashBytes]);
}

/** Typed records only (ArchOwner / BitcoinTaproot / TokenAta). */
export function deriveRecordAddress(
  programId: ArchAddress,
  namespace: string,
  nameHashBytes: Uint8Array,
  recordType: Exclude<RecordType, "Text">,
): ArchAddress {
  return derive(programId, [
    RECORD_SEED,
    namespaceHash(namespace),
    nameHashBytes,
    Uint8Array.of(recordTypeByte(recordType)),
  ]);
}

export function deriveTextRecordAddress(
  programId: ArchAddress,
  namespace: string,
  nameHashBytes: Uint8Array,
  key: string,
): ArchAddress {
  return derive(programId, [
    RECORD_SEED,
    namespaceHash(namespace),
    nameHashBytes,
    Uint8Array.of(recordTypeByte("Text")),
    recordKeyHash(key),
  ]);
}

export function deriveRecordAddressFor(
  programId: ArchAddress,
  namespace: string,
  nameHashBytes: Uint8Array,
  recordType: RecordType,
  textKey?: string,
): ArchAddress {
  if (recordType === "Text") {
    if (!textKey) {
      throw new Error("Text records require a key");
    }
    return deriveTextRecordAddress(programId, namespace, nameHashBytes, textKey);
  }
  return deriveRecordAddress(programId, namespace, nameHashBytes, recordType);
}

export function deriveReverseAddress(
  programId: ArchAddress,
  namespace: string,
  owner: ArchAddress,
): ArchAddress {
  return derive(programId, [REVERSE_SEED, namespaceHash(namespace), owner]);
}

export function deriveListingAddress(
  programId: ArchAddress,
  namespace: string,
  nameHashBytes: Uint8Array,
): ArchAddress {
  return derive(programId, [LISTING_SEED, namespaceHash(namespace), nameHashBytes]);
}

export function deriveOfferAddress(
  programId: ArchAddress,
  namespace: string,
  nameHashBytes: Uint8Array,
  buyer: ArchAddress,
): ArchAddress {
  return derive(programId, [
    OFFER_SEED,
    namespaceHash(namespace),
    nameHashBytes,
    buyer,
  ]);
}

export function deriveTokenAta(
  owner: ArchAddress,
  tokenId: ArchAddress,
  tokenProgramId: ArchAddress,
  associatedTokenProgramId: ArchAddress,
): ArchAddress {
  return PubkeyUtil.findProgramAddress(
    [owner, tokenProgramId, tokenId],
    associatedTokenProgramId,
  )[0];
}
