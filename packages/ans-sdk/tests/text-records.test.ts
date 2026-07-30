import { describe, expect, it } from "vitest";

import {
  decodeRecordValue,
  encodeRecordValue,
} from "../src/codec/state.js";
import { BorshReader } from "../src/codec/reader.js";
import {
  deriveRecordAddress,
  deriveRecordAddressFor,
  deriveTextRecordAddress,
} from "../src/derive.js";
import { hexToBytes } from "../src/hex.js";
import {
  TEXT_RECORD_CATALOG,
  validateTextRecordInput,
} from "../src/records/catalog.js";
import { validateTextKey, validateTextValue } from "../src/validate.js";

const PROGRAM = hexToBytes("03".repeat(32));
const NAME_HASH = hexToBytes("11".repeat(32));

describe("text record catalog", () => {
  it("covers the SNS user-facing record surface", () => {
    const keys = new Set(TEXT_RECORD_CATALOG.map((row) => row.key));
    for (const required of [
      "eth",
      "ltc",
      "doge",
      "bsc",
      "inj",
      "ipfs",
      "arwv",
      "ipns",
      "shdw",
      "point",
      "email",
      "url",
      "discord",
      "github",
      "reddit",
      "twitter",
      "telegram",
      "pic",
    ]) {
      expect(keys.has(required as never)).toBe(true);
    }
  });

  it("validates ETH and URL drafts", () => {
    expect(validateTextRecordInput("eth", "0x" + "ab".repeat(20))).toBeNull();
    expect(validateTextRecordInput("eth", "not-an-address")).toMatch(/0x/);
    expect(validateTextRecordInput("url", "https://arch.network")).toBeNull();
    expect(validateTextRecordInput("url", "ftp://bad")).toMatch(/https/);
  });
});

describe("text record encode/decode", () => {
  it("round-trips Text values", () => {
    const value = { kind: "Text" as const, key: "eth", value: "0x" + "11".repeat(20) };
    const encoded = encodeRecordValue(value).finish();
    const decoded = decodeRecordValue(new BorshReader(encoded));
    expect(decoded).toEqual(value);
  });

  it("keeps typed record PDAs stable and isolates Text by key", () => {
    const arch = deriveRecordAddress(PROGRAM, ".arch", NAME_HASH, "ArchOwner");
    const taproot = deriveRecordAddress(PROGRAM, ".arch", NAME_HASH, "BitcoinTaproot");
    const eth = deriveTextRecordAddress(PROGRAM, ".arch", NAME_HASH, "eth");
    const url = deriveTextRecordAddress(PROGRAM, ".arch", NAME_HASH, "url");
    expect(arch).not.toEqual(taproot);
    expect(eth).not.toEqual(url);
    expect(deriveRecordAddressFor(PROGRAM, ".arch", NAME_HASH, "Text", "eth")).toEqual(eth);
  });

  it("rejects invalid text keys/values", () => {
    expect(() => validateTextKey("ETH")).toThrow();
    expect(() => validateTextKey("eth")).not.toThrow();
    expect(() => validateTextValue("ok")).not.toThrow();
    expect(() => validateTextValue("has\nnewline")).toThrow();
  });
});
