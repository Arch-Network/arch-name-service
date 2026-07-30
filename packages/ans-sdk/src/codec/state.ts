import {
  LISTING_ACCOUNT_DISCRIMINATOR,
  NAME_ACCOUNT_DISCRIMINATOR,
  OFFER_ACCOUNT_DISCRIMINATOR,
  RECORD_ACCOUNT_DISCRIMINATOR,
  REGISTRY_CONFIG_DISCRIMINATOR,
  REVERSE_ACCOUNT_DISCRIMINATOR,
  STATE_VERSION,
} from "../constants.js";
import { AnsError } from "../errors.js";
import { bytesEqual } from "../hex.js";
import type {
  AccountHeader,
  BitcoinNetwork,
  ListingAccount,
  NameAccount,
  OfferAccount,
  QuoteCurrency,
  RecordAccount,
  RecordType,
  RecordValue,
  RegistryConfig,
  ReverseAccount,
  TokenProgramConfig,
} from "../types.js";
import { BorshReader } from "./reader.js";
import { BorshWriter } from "./writer.js";

const BITCOIN_NETWORKS: BitcoinNetwork[] = ["mainnet", "testnet", "signet", "regtest"];
const RECORD_TYPES: RecordType[] = ["ArchOwner", "BitcoinTaproot", "TokenAta", "Text"];
const QUOTE_CURRENCIES: QuoteCurrency[] = ["Arch", "Btc"];

export function encodeHeader(header: AccountHeader, writer = new BorshWriter()): BorshWriter {
  return writer.bytes(header.discriminator).bool(header.initialized).u16(header.stateVersion);
}

export function decodeHeader(reader: BorshReader): AccountHeader {
  return {
    discriminator: reader.bytes(8),
    initialized: reader.bool(),
    stateVersion: reader.u16(),
  };
}

export function validateHeader(header: AccountHeader, discriminator: Uint8Array): void {
  if (!bytesEqual(header.discriminator, discriminator)) {
    throw new AnsError("InvalidDiscriminator");
  }
  if (!header.initialized || header.stateVersion !== STATE_VERSION) {
    throw new AnsError("UnsupportedAccountVersion");
  }
}

function encodeBitcoinNetwork(network: BitcoinNetwork, writer: BorshWriter): void {
  writer.u8(BITCOIN_NETWORKS.indexOf(network));
}

function decodeBitcoinNetwork(reader: BorshReader): BitcoinNetwork {
  const index = reader.u8();
  const network = BITCOIN_NETWORKS[index];
  if (!network) throw new AnsError("CodecError", "invalid bitcoin network");
  return network;
}

function encodeRecordType(recordType: RecordType, writer: BorshWriter): void {
  writer.u8(RECORD_TYPES.indexOf(recordType));
}

function decodeRecordType(reader: BorshReader): RecordType {
  const index = reader.u8();
  const recordType = RECORD_TYPES[index];
  if (!recordType) throw new AnsError("CodecError", "invalid record type");
  return recordType;
}

export function encodeRecordValue(value: RecordValue, writer = new BorshWriter()): BorshWriter {
  switch (value.kind) {
    case "ArchOwner":
      return writer.u8(0).pubkey(value.owner);
    case "BitcoinTaproot":
      return writer.u8(1).pubkey(value.witnessProgram);
    case "TokenAta":
      return writer.u8(2).pubkey(value.tokenId).pubkey(value.ata);
    case "Text":
      return writer.u8(3).string(value.key).string(value.value);
  }
}

export function decodeRecordValue(reader: BorshReader): RecordValue {
  const kind = reader.u8();
  if (kind === 0) return { kind: "ArchOwner", owner: reader.pubkey() };
  if (kind === 1) return { kind: "BitcoinTaproot", witnessProgram: reader.pubkey() };
  if (kind === 2) {
    return { kind: "TokenAta", tokenId: reader.pubkey(), ata: reader.pubkey() };
  }
  if (kind === 3) {
    return { kind: "Text", key: reader.string(), value: reader.string() };
  }
  throw new AnsError("CodecError", "invalid record value");
}

export function encodeRegistryConfig(config: RegistryConfig): Uint8Array {
  const writer = new BorshWriter();
  encodeHeader(config.header, writer);
  writer.u16(config.programVersion).u32(config.networkId).string(config.namespace);
  writer.pubkey(config.namespaceAuthority);
  writer
    .u64(config.gracePeriodSlots)
    .u64(config.minRegistrationSlots)
    .u64(config.maxRegistrationSlots);
  encodeBitcoinNetwork(config.bitcoinNetwork, writer);
  writer.u32(config.tokenPrograms.length);
  for (const program of config.tokenPrograms) {
    writer.pubkey(program.tokenProgramId).pubkey(program.associatedTokenProgramId);
  }
  writer.bool(config.paused).bool(config.mainnetEnabled);
  return writer.finish();
}

export function decodeRegistryConfig(data: Uint8Array): RegistryConfig {
  const reader = new BorshReader(data);
  const header = decodeHeader(reader);
  const programVersion = reader.u16();
  const networkId = reader.u32();
  const namespace = reader.string();
  const namespaceAuthority = reader.pubkey();
  const gracePeriodSlots = reader.u64();
  const minRegistrationSlots = reader.u64();
  const maxRegistrationSlots = reader.u64();
  const bitcoinNetwork = decodeBitcoinNetwork(reader);
  const tokenProgramCount = reader.u32();
  const tokenPrograms: TokenProgramConfig[] = [];
  for (let i = 0; i < tokenProgramCount; i++) {
    tokenPrograms.push({
      tokenProgramId: reader.pubkey(),
      associatedTokenProgramId: reader.pubkey(),
    });
  }
  const paused = reader.bool();
  const mainnetEnabled = reader.bool();
  reader.finish();
  return {
    header,
    programVersion,
    networkId,
    namespace,
    namespaceAuthority,
    gracePeriodSlots,
    minRegistrationSlots,
    maxRegistrationSlots,
    bitcoinNetwork,
    tokenPrograms,
    paused,
    mainnetEnabled,
  };
}

export function encodeNameAccount(name: NameAccount): Uint8Array {
  const writer = new BorshWriter();
  encodeHeader(name.header, writer);
  writer
    .pubkey(name.nameHash)
    .string(name.canonicalLabel)
    .pubkey(name.owner)
    .u64(name.registeredAtSlot)
    .u64(name.expiresAtSlot)
    .u64(name.recordEpoch)
    .u64(name.primaryBindingNonce);
  return writer.finish();
}

export function decodeNameAccount(data: Uint8Array): NameAccount {
  const reader = new BorshReader(data);
  const name: NameAccount = {
    header: decodeHeader(reader),
    nameHash: reader.pubkey(),
    canonicalLabel: reader.string(),
    owner: reader.pubkey(),
    registeredAtSlot: reader.u64(),
    expiresAtSlot: reader.u64(),
    recordEpoch: reader.u64(),
    primaryBindingNonce: reader.u64(),
  };
  reader.finish();
  return name;
}

export function encodeRecordAccount(record: RecordAccount): Uint8Array {
  const writer = new BorshWriter();
  encodeHeader(record.header, writer);
  writer.pubkey(record.nameHash);
  encodeRecordType(record.recordType, writer);
  writer.pubkey(record.ownerSnapshot).u64(record.recordEpoch).u64(record.revision);
  encodeRecordValue(record.value, writer);
  writer.u64(record.updatedAtSlot);
  return writer.finish();
}

export function decodeRecordAccount(data: Uint8Array): RecordAccount {
  const reader = new BorshReader(data);
  const record: RecordAccount = {
    header: decodeHeader(reader),
    nameHash: reader.pubkey(),
    recordType: decodeRecordType(reader),
    ownerSnapshot: reader.pubkey(),
    recordEpoch: reader.u64(),
    revision: reader.u64(),
    value: decodeRecordValue(reader),
    updatedAtSlot: reader.u64(),
  };
  reader.finish();
  return record;
}

export function encodeReverseAccount(reverse: ReverseAccount): Uint8Array {
  const writer = new BorshWriter();
  encodeHeader(reverse.header, writer);
  writer
    .pubkey(reverse.owner)
    .pubkey(reverse.primaryNameHash)
    .u64(reverse.bindingNonce)
    .u64(reverse.updatedAtSlot);
  return writer.finish();
}

export function decodeReverseAccount(data: Uint8Array): ReverseAccount {
  const reader = new BorshReader(data);
  const reverse: ReverseAccount = {
    header: decodeHeader(reader),
    owner: reader.pubkey(),
    primaryNameHash: reader.pubkey(),
    bindingNonce: reader.u64(),
    updatedAtSlot: reader.u64(),
  };
  reader.finish();
  return reverse;
}

export function encodeListingAccount(listing: ListingAccount): Uint8Array {
  const writer = new BorshWriter();
  encodeHeader(listing.header, writer);
  writer
    .pubkey(listing.nameHash)
    .pubkey(listing.seller)
    .u8(QUOTE_CURRENCIES.indexOf(listing.currency))
    .u64(listing.price)
    .u64(listing.createdAtSlot)
    .bool(listing.active);
  return writer.finish();
}

export function decodeListingAccount(data: Uint8Array): ListingAccount {
  const reader = new BorshReader(data);
  const header = decodeHeader(reader);
  const nameHash = reader.pubkey();
  const seller = reader.pubkey();
  const currency = QUOTE_CURRENCIES[reader.u8()];
  if (!currency) throw new AnsError("CodecError", "invalid quote currency");
  const listing: ListingAccount = {
    header,
    nameHash,
    seller,
    currency,
    price: reader.u64(),
    createdAtSlot: reader.u64(),
    active: reader.bool(),
  };
  reader.finish();
  return listing;
}

export function encodeOfferAccount(offer: OfferAccount): Uint8Array {
  const writer = new BorshWriter();
  encodeHeader(offer.header, writer);
  writer
    .pubkey(offer.nameHash)
    .pubkey(offer.buyer)
    .u8(QUOTE_CURRENCIES.indexOf(offer.currency))
    .u64(offer.price)
    .u64(offer.createdAtSlot)
    .bool(offer.active);
  return writer.finish();
}

export function decodeOfferAccount(data: Uint8Array): OfferAccount {
  const reader = new BorshReader(data);
  const header = decodeHeader(reader);
  const nameHash = reader.pubkey();
  const buyer = reader.pubkey();
  const currency = QUOTE_CURRENCIES[reader.u8()];
  if (!currency) throw new AnsError("CodecError", "invalid quote currency");
  const offer: OfferAccount = {
    header,
    nameHash,
    buyer,
    currency,
    price: reader.u64(),
    createdAtSlot: reader.u64(),
    active: reader.bool(),
  };
  reader.finish();
  return offer;
}

export function initializedHeader(discriminator: Uint8Array): AccountHeader {
  return {
    discriminator: Uint8Array.from(discriminator),
    initialized: true,
    stateVersion: STATE_VERSION,
  };
}

export {
  LISTING_ACCOUNT_DISCRIMINATOR,
  NAME_ACCOUNT_DISCRIMINATOR,
  OFFER_ACCOUNT_DISCRIMINATOR,
  RECORD_ACCOUNT_DISCRIMINATOR,
  REGISTRY_CONFIG_DISCRIMINATOR,
  REVERSE_ACCOUNT_DISCRIMINATOR,
};
