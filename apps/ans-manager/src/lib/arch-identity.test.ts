/**
 * The rule these tests pin down: an account mismatch must mean a
 * different *key*, never a different *spelling* of the same key. A false
 * mismatch aborts a registration the user could have completed and sends
 * them into a reconnect loop that cannot fix anything.
 */

import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import {
  archIdentitiesEqual,
  archIdentityFingerprint,
  canonicalArchKeyHex,
  shortArchAddress,
} from "./arch-identity";

const KEY_HEX = "3a7f1c9b2e5d48a06f13c4b7d9e2085fa16c3d7e4b90128fa6c5d3e7b1042f9c";
const KEY_BYTES = Uint8Array.from(
  KEY_HEX.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)),
);
const KEY_BASE58 = bs58.encode(KEY_BYTES);
const OTHER_HEX = "9c2f04b1e7d3c5a6fa2801904b7e3d61af85202e9d7b3c4f06a8d4e2b9c1f7a3";
const OTHER_BASE58 = bs58.encode(
  Uint8Array.from(OTHER_HEX.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16))),
);

describe("canonicalArchKeyHex", () => {
  it("accepts base58, hex, 0x-prefixed hex, and uppercase hex", () => {
    expect(canonicalArchKeyHex(KEY_BASE58)).toBe(KEY_HEX);
    expect(canonicalArchKeyHex(KEY_HEX)).toBe(KEY_HEX);
    expect(canonicalArchKeyHex(`0x${KEY_HEX}`)).toBe(KEY_HEX);
    expect(canonicalArchKeyHex(KEY_HEX.toUpperCase())).toBe(KEY_HEX);
    expect(canonicalArchKeyHex(`  ${KEY_BASE58}  `)).toBe(KEY_HEX);
  });

  it("strips the parity byte from a 33-byte compressed key", () => {
    expect(canonicalArchKeyHex(`02${KEY_HEX}`)).toBe(KEY_HEX);
    expect(canonicalArchKeyHex(`03${KEY_HEX}`)).toBe(KEY_HEX);
    expect(canonicalArchKeyHex(bs58.encode(Uint8Array.from([2, ...KEY_BYTES])))).toBe(
      KEY_HEX,
    );
  });

  it("returns null for values that are not 32-byte Arch keys", () => {
    expect(canonicalArchKeyHex("")).toBeNull();
    expect(canonicalArchKeyHex(undefined)).toBeNull();
    expect(canonicalArchKeyHex("not an address")).toBeNull();
    expect(canonicalArchKeyHex("tb1pqqqqqq")).toBeNull();
  });
});

describe("archIdentitiesEqual", () => {
  it("treats equivalent encodings of one key as the same account", () => {
    const spellings = [
      KEY_BASE58,
      KEY_HEX,
      KEY_HEX.toUpperCase(),
      `0x${KEY_HEX}`,
      ` ${KEY_HEX} `,
      `02${KEY_HEX}`,
      bs58.encode(Uint8Array.from([3, ...KEY_BYTES])),
    ];
    for (const a of spellings) {
      for (const b of spellings) {
        expect(archIdentitiesEqual(a, b)).toBe(true);
      }
    }
  });

  it("reports a genuinely different key as a mismatch", () => {
    expect(archIdentitiesEqual(KEY_BASE58, OTHER_BASE58)).toBe(false);
    expect(archIdentitiesEqual(KEY_HEX, OTHER_HEX)).toBe(false);
    expect(archIdentitiesEqual(KEY_BASE58, OTHER_HEX)).toBe(false);
    expect(archIdentitiesEqual(`02${KEY_HEX}`, `02${OTHER_HEX}`)).toBe(false);
  });

  it("does not call a missing account equal to a present one", () => {
    expect(archIdentitiesEqual(KEY_BASE58, "")).toBe(false);
    expect(archIdentitiesEqual(KEY_BASE58, undefined)).toBe(false);
    expect(archIdentitiesEqual(null, undefined)).toBe(false);
  });

  it("still matches identical values it cannot decode", () => {
    expect(archIdentitiesEqual("legacy-value", "legacy-value")).toBe(true);
    expect(archIdentitiesEqual("legacy-value", "other-value")).toBe(false);
  });
});

describe("display helpers", () => {
  it("shortens an address to something a person can compare", () => {
    const short = shortArchAddress(KEY_BASE58);
    expect(short).toContain("…");
    expect(short.startsWith(KEY_BASE58.slice(0, 6))).toBe(true);
    expect(short.endsWith(KEY_BASE58.slice(-6))).toBe(true);
  });

  it("fingerprints both encodings of one key to the same canonical tail", () => {
    const fromBase58 = archIdentityFingerprint(KEY_BASE58);
    const fromHex = archIdentityFingerprint(KEY_HEX);
    expect(fromBase58).toContain(KEY_HEX.slice(0, 8));
    expect(fromHex).toContain(KEY_HEX.slice(0, 8));
  });

  it("flags an unrecognized encoding instead of pretending it parsed", () => {
    expect(archIdentityFingerprint("garbage")).toContain("unrecognized");
  });
});
