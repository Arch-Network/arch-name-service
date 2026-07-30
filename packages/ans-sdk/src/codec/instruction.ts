import { AnsError } from "../errors.js";
import type { ArchAddress, QuoteCurrency, RecordType, RecordValue } from "../types.js";
import { BorshReader } from "./reader.js";
import { decodeRecordValue, encodeRecordValue } from "./state.js";
import { BorshWriter } from "./writer.js";

export type NameInstruction =
  | { kind: "InitializeRegistry"; networkId: number; namespaceAuthority: ArchAddress }
  | { kind: "Register"; label: string; durationSlots: bigint }
  | { kind: "Renew"; nameHash: Uint8Array; durationSlots: bigint }
  | { kind: "Transfer"; nameHash: Uint8Array; newOwner: ArchAddress }
  | {
      kind: "SetRecord";
      nameHash: Uint8Array;
      recordType: RecordType;
      value: RecordValue;
      expectedRevision: bigint;
    }
  | {
      kind: "DeleteRecord";
      nameHash: Uint8Array;
      recordType: RecordType;
      textKey: string;
      expectedRevision: bigint;
    }
  | { kind: "SetPrimary"; nameHash: Uint8Array }
  | { kind: "ClearPrimary" }
  | { kind: "ReclaimExpired"; label: string; durationSlots: bigint }
  | {
      kind: "UpdateConfig";
      paused: boolean | null;
      gracePeriodSlots: bigint | null;
    }
  | { kind: "ListName"; nameHash: Uint8Array; currency: QuoteCurrency; price: bigint }
  | { kind: "CancelListing"; nameHash: Uint8Array }
  | { kind: "BuyName"; nameHash: Uint8Array };

const RECORD_TYPES: RecordType[] = ["ArchOwner", "BitcoinTaproot", "TokenAta", "Text"];
const QUOTE_CURRENCIES: QuoteCurrency[] = ["Arch", "Btc"];

function encodeOptionBool(writer: BorshWriter, value: boolean | null): void {
  if (value === null) {
    writer.u8(0);
  } else {
    writer.u8(1).bool(value);
  }
}

function encodeOptionU64(writer: BorshWriter, value: bigint | null): void {
  if (value === null) {
    writer.u8(0);
  } else {
    writer.u8(1).u64(value);
  }
}

function decodeOptionBool(reader: BorshReader): boolean | null {
  return reader.u8() === 0 ? null : reader.bool();
}

function decodeOptionU64(reader: BorshReader): bigint | null {
  return reader.u8() === 0 ? null : reader.u64();
}

function encodeRecordType(writer: BorshWriter, recordType: RecordType): void {
  writer.u8(RECORD_TYPES.indexOf(recordType));
}

function decodeRecordType(reader: BorshReader): RecordType {
  const recordType = RECORD_TYPES[reader.u8()];
  if (!recordType) throw new AnsError("CodecError", "invalid record type");
  return recordType;
}

export function encodeInstruction(ix: NameInstruction): Uint8Array {
  const writer = new BorshWriter();
  switch (ix.kind) {
    case "InitializeRegistry":
      return writer
        .u8(0)
        .u32(ix.networkId)
        .pubkey(ix.namespaceAuthority)
        .finish();
    case "Register":
      return writer.u8(1).string(ix.label).u64(ix.durationSlots).finish();
    case "Renew":
      return writer.u8(2).pubkey(ix.nameHash).u64(ix.durationSlots).finish();
    case "Transfer":
      return writer.u8(3).pubkey(ix.nameHash).pubkey(ix.newOwner).finish();
    case "SetRecord":
      writer.u8(4).pubkey(ix.nameHash);
      encodeRecordType(writer, ix.recordType);
      encodeRecordValue(ix.value, writer);
      return writer.u64(ix.expectedRevision).finish();
    case "DeleteRecord":
      writer.u8(5).pubkey(ix.nameHash);
      encodeRecordType(writer, ix.recordType);
      return writer.string(ix.textKey).u64(ix.expectedRevision).finish();
    case "SetPrimary":
      return writer.u8(6).pubkey(ix.nameHash).finish();
    case "ClearPrimary":
      return writer.u8(7).finish();
    case "ReclaimExpired":
      return writer.u8(8).string(ix.label).u64(ix.durationSlots).finish();
    case "UpdateConfig":
      writer.u8(9);
      encodeOptionBool(writer, ix.paused);
      encodeOptionU64(writer, ix.gracePeriodSlots);
      return writer.finish();
    case "ListName":
      return writer
        .u8(10)
        .pubkey(ix.nameHash)
        .u8(QUOTE_CURRENCIES.indexOf(ix.currency))
        .u64(ix.price)
        .finish();
    case "CancelListing":
      return writer.u8(11).pubkey(ix.nameHash).finish();
    case "BuyName":
      return writer.u8(12).pubkey(ix.nameHash).finish();
  }
}

export function decodeInstruction(data: Uint8Array): NameInstruction {
  const reader = new BorshReader(data);
  const kind = reader.u8();
  let ix: NameInstruction;
  switch (kind) {
    case 0:
      ix = {
        kind: "InitializeRegistry",
        networkId: reader.u32(),
        namespaceAuthority: reader.pubkey(),
      };
      break;
    case 1:
      ix = {
        kind: "Register",
        label: reader.string(),
        durationSlots: reader.u64(),
      };
      break;
    case 2:
      ix = {
        kind: "Renew",
        nameHash: reader.pubkey(),
        durationSlots: reader.u64(),
      };
      break;
    case 3:
      ix = {
        kind: "Transfer",
        nameHash: reader.pubkey(),
        newOwner: reader.pubkey(),
      };
      break;
    case 4:
      ix = {
        kind: "SetRecord",
        nameHash: reader.pubkey(),
        recordType: decodeRecordType(reader),
        value: decodeRecordValue(reader),
        expectedRevision: reader.u64(),
      };
      break;
    case 5:
      ix = {
        kind: "DeleteRecord",
        nameHash: reader.pubkey(),
        recordType: decodeRecordType(reader),
        textKey: reader.string(),
        expectedRevision: reader.u64(),
      };
      break;
    case 6:
      ix = { kind: "SetPrimary", nameHash: reader.pubkey() };
      break;
    case 7:
      ix = { kind: "ClearPrimary" };
      break;
    case 8:
      ix = {
        kind: "ReclaimExpired",
        label: reader.string(),
        durationSlots: reader.u64(),
      };
      break;
    case 9:
      ix = {
        kind: "UpdateConfig",
        paused: decodeOptionBool(reader),
        gracePeriodSlots: decodeOptionU64(reader),
      };
      break;
    case 10: {
      const nameHash = reader.pubkey();
      const currency = QUOTE_CURRENCIES[reader.u8()];
      if (!currency) throw new AnsError("CodecError", "invalid quote currency");
      ix = {
        kind: "ListName",
        nameHash,
        currency,
        price: reader.u64(),
      };
      break;
    }
    case 11:
      ix = { kind: "CancelListing", nameHash: reader.pubkey() };
      break;
    case 12:
      ix = { kind: "BuyName", nameHash: reader.pubkey() };
      break;
    default:
      throw new AnsError("CodecError", `unknown instruction variant ${kind}`);
  }
  reader.finish();
  return ix;
}
