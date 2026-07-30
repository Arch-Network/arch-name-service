import { describe, expect, it, vi } from "vitest";
import {
  decodeRawWalletSignature,
  extractSchnorrHexFromWalletSignature,
  getWalletWitnessSignatureItem,
} from "./bip322-witness";

vi.mock("@saturnbtcio/arch-sdk", () => ({
  SignatureUtil: {
    adjustSignature: (sig: Uint8Array) => {
      if (sig.length === 65) return sig.slice(0, 64);
      return sig;
    },
  },
}));

function hex(n: number, byte = 0xab): string {
  return byte.toString(16).padStart(2, "0").repeat(n);
}

/** Minimal BIP-322 simple witness: stack count 1 + compact size + item. */
function serializeSimpleWitness(item: Uint8Array): string {
  if (item.length >= 0xfd) throw new Error("test helper only supports short items");
  const out = new Uint8Array(2 + item.length);
  out[0] = 1;
  out[1] = item.length;
  out.set(item, 2);
  let binary = "";
  for (const b of out) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe("bip322-witness extract", () => {
  it("unwraps a BIP-322 simple witness blob to 64-byte hex", () => {
    const schnorr = Uint8Array.from({ length: 64 }, (_, i) => i);
    const blob = serializeSimpleWitness(schnorr);
    const item = getWalletWitnessSignatureItem(blob);
    expect(item).not.toBeNull();
    expect(item!.length).toBe(64);
    expect(extractSchnorrHexFromWalletSignature(blob)).toBe(
      Array.from(schnorr, (b) => b.toString(16).padStart(2, "0")).join(""),
    );
  });

  it("accepts raw 64-byte hex without witness framing", () => {
    const raw = hex(64, 0xcd);
    expect(extractSchnorrHexFromWalletSignature(raw)).toBe(raw);
  });

  it("prefers hex decoding when input is hex-like", () => {
    const raw = hex(64, 0x11);
    const bytes = decodeRawWalletSignature(raw);
    expect(bytes.length).toBe(64);
    expect(bytes[0]).toBe(0x11);
  });
});
