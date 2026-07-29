import { bech32m } from "bech32";

import { encodeRecordValue } from "./codec/state.js";
import { deriveTokenAta } from "./derive.js";
import { AnsError } from "./errors.js";
import { bytesEqual } from "./hex.js";
import type {
  BitcoinNetwork,
  NameAccount,
  RecordType,
  RecordValue,
  RegistryConfig,
  TokenProgramConfig,
} from "./types.js";

export function isActive(name: NameAccount, currentSlot: bigint): boolean {
  return currentSlot < name.expiresAtSlot;
}

function hrp(network: BitcoinNetwork): string {
  switch (network) {
    case "mainnet":
      return "bc";
    case "testnet":
    case "signet":
      return "tb";
    case "regtest":
      return "bcrt";
  }
}

export function encodeTaprootAddress(
  witnessProgram: Uint8Array,
  network: BitcoinNetwork,
): string {
  if (witnessProgram.length !== 32) {
    throw new AnsError("InvalidTaprootAddress");
  }
  const words = bech32m.toWords(witnessProgram);
  words.unshift(1);
  return bech32m.encode(hrp(network), words);
}

export function parseTaprootAddress(
  address: string,
  network: BitcoinNetwork,
): RecordValue {
  let decoded;
  try {
    decoded = bech32m.decode(address);
  } catch {
    throw new AnsError("InvalidTaprootAddress");
  }
  if (decoded.prefix !== hrp(network) || decoded.words[0] !== 1) {
    throw new AnsError("InvalidTaprootAddress");
  }
  const program = Uint8Array.from(bech32m.fromWords(decoded.words.slice(1)));
  if (program.length !== 32) {
    throw new AnsError("InvalidTaprootAddress");
  }
  const canonical = encodeTaprootAddress(program, network);
  if (canonical !== address) {
    throw new AnsError("InvalidTaprootAddress");
  }
  return { kind: "BitcoinTaproot", witnessProgram: program };
}

export function maxRecordValueLen(recordType: RecordType): number {
  switch (recordType) {
    case "ArchOwner":
    case "BitcoinTaproot":
      return 33;
    case "TokenAta":
      return 65;
  }
}

function validateTokenAta(
  owner: Uint8Array,
  tokenId: Uint8Array,
  ata: Uint8Array,
  configured: TokenProgramConfig[],
): void {
  for (const programs of configured) {
    const expected = deriveTokenAta(
      owner,
      tokenId,
      programs.tokenProgramId,
      programs.associatedTokenProgramId,
    );
    if (bytesEqual(expected, ata)) return;
  }
  throw new AnsError("InvalidTokenAta");
}

export function validateRecordValue(
  config: RegistryConfig,
  name: NameAccount,
  recordType: RecordType,
  value: RecordValue,
): void {
  if (value.kind !== recordType) {
    throw new AnsError("RecordTypeMismatch");
  }
  if (encodeRecordValue(value).finish().length > maxRecordValueLen(recordType)) {
    throw new AnsError("RecordValueTooLarge");
  }
  switch (value.kind) {
    case "ArchOwner":
      if (!bytesEqual(value.owner, name.owner)) {
        throw new AnsError("OwnerRecordMismatch");
      }
      return;
    case "BitcoinTaproot":
      encodeTaprootAddress(value.witnessProgram, config.bitcoinNetwork);
      return;
    case "TokenAta":
      validateTokenAta(name.owner, value.tokenId, value.ata, config.tokenPrograms);
      return;
  }
}
