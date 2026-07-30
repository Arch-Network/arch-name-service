/**
 * The digests here are not this file's own invention: each one was
 * produced by the Arch Wallet extension's `computeBip322ToSignTaprootSighash`
 * (bip322-js + bitcoinjs-lib) for the same inputs. Pinning them means a
 * change in this module that drifts from what the wallet actually signs
 * shows up as a failing test rather than as a registration that the node
 * rejects after the user approves it.
 *
 * The first internal key is secp256k1's generator x-coordinate, whose
 * BIP-86 output key and address are the published BIP-86 test vector —
 * so the tweak step is independently checkable too.
 */

import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { schnorr } from "@noble/curves/secp256k1";
import {
  bip322TaprootSighash,
  checkArchSignature,
  p2trScriptPubKey,
  taprootOutputKey,
} from "./bip322";

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)));

const REFERENCE = [
  {
    internal: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    outputKey: "da4710964f7852695de2da025290e24af6d8c281de5a0b902b7135fd9fd74d21",
    message: "0".repeat(64),
    sighash: "fddbe89559b044bb91b086440eca055029e76373bd044841d18cdc71e3c0213d",
  },
  {
    internal: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    outputKey: "da4710964f7852695de2da025290e24af6d8c281de5a0b902b7135fd9fd74d21",
    message: "8ff6327b05fb7970a12c34f1a63cc37734ffbba3152979aa32fc4396b88c849a",
    sighash: "5c5cd5373f8b7af028ad5acf35f521bf3de57c9df77111626d8f669582586249",
  },
  {
    internal: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    outputKey: "cafd90c7026f0b6ab98df89490d02732881f2f4b5900856358dddff4679c2ffb",
    message: "0".repeat(64),
    sighash: "f0a0ff7d4548274e693e2bb7f6293c59e18aeabe5e494453a5c5a6cc2647f1d2",
  },
  {
    internal: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    outputKey: "cafd90c7026f0b6ab98df89490d02732881f2f4b5900856358dddff4679c2ffb",
    message: "8ff6327b05fb7970a12c34f1a63cc37734ffbba3152979aa32fc4396b88c849a",
    sighash: "4669d70d633c01ed0a678a23a08dd27ee7bdac5e774d550b5ae5d6abd47f77d9",
  },
];

describe("taproot / BIP-322 primitives", () => {
  it("derives the BIP-86 output key the wallet's address encodes", () => {
    for (const vector of REFERENCE) {
      expect(toHex(taprootOutputKey(fromHex(vector.internal)))).toBe(vector.outputKey);
    }
  });

  it("builds the P2TR scriptPubKey, which is network-independent", () => {
    const script = p2trScriptPubKey(fromHex(REFERENCE[0].outputKey));
    expect(toHex(script)).toBe(`5120${REFERENCE[0].outputKey}`);
  });

  it("reproduces the extension's to-sign sighash exactly", () => {
    for (const vector of REFERENCE) {
      const digest = bip322TaprootSighash(fromHex(vector.outputKey), vector.message);
      expect(toHex(digest)).toBe(vector.sighash);
    }
  });
});

/** A signer that behaves like the wallet: BIP-86 tweak, then sign. */
function walletFor(secretHex: string) {
  const scalar = BigInt(`0x${secretHex}`);
  const internalPoint = schnorr.Point.BASE.multiply(scalar);
  const internal = schnorr.utils.pointToBytes(internalPoint);
  // BIP-86: negate the scalar when the internal point has odd Y, then add
  // the tweak. Same arithmetic Turnkey performs for a taproot address.
  const order = schnorr.Point.Fn.ORDER;
  const base = internalPoint.toAffine().y % 2n === 0n ? scalar : order - scalar;
  const tweak = BigInt(`0x${toHex(schnorr.utils.taggedHash("TapTweak", internal))}`);
  const tweaked = (base + tweak) % order;
  return {
    archAddress: bs58.encode(internal),
    sign(message: string): string {
      const digest = bip322TaprootSighash(taprootOutputKey(internal), message);
      return toHex(
        schnorr.sign(digest, fromHex(tweaked.toString(16).padStart(64, "0"))),
      );
    },
  };
}

const MESSAGE = "8ff6327b05fb7970a12c34f1a63cc37734ffbba3152979aa32fc4396b88c849a";

describe("checkArchSignature", () => {
  const alice = walletFor("11".repeat(32));
  const bob = walletFor("22".repeat(32));

  it("accepts a signature from the account that produced it", () => {
    expect(checkArchSignature(alice.archAddress, MESSAGE, alice.sign(MESSAGE))).toBe(
      "match",
    );
  });

  it("catches the wallet signing as a different account", () => {
    expect(checkArchSignature(alice.archAddress, MESSAGE, bob.sign(MESSAGE))).toBe(
      "mismatch",
    );
  });

  it("matches across encodings of the same key", () => {
    const hex = toHex(bs58.decode(alice.archAddress));
    const signature = alice.sign(MESSAGE);
    expect(checkArchSignature(hex, MESSAGE, signature)).toBe("match");
    expect(checkArchSignature(`0x${hex.toUpperCase()}`, MESSAGE, signature)).toBe("match");
    // A compressed key's parity byte is not part of the Arch identity.
    expect(checkArchSignature(`02${hex}`, MESSAGE, signature)).toBe("match");
    expect(checkArchSignature(`03${hex}`, MESSAGE, signature)).toBe("match");
  });

  it("rejects a signature over a different message", () => {
    const other = "aa".repeat(32);
    expect(checkArchSignature(alice.archAddress, other, alice.sign(MESSAGE))).toBe(
      "mismatch",
    );
  });

  it("says 'unverifiable' rather than guessing on shapes it does not model", () => {
    const signature = alice.sign(MESSAGE);
    // 65-byte signature: a non-default SIGHASH byte implies another digest.
    expect(checkArchSignature(alice.archAddress, MESSAGE, `${signature}01`)).toBe(
      "unverifiable",
    );
    expect(checkArchSignature("not-an-address", MESSAGE, signature)).toBe("unverifiable");
    expect(checkArchSignature(alice.archAddress, "short", signature)).toBe("unverifiable");
    expect(checkArchSignature(null, MESSAGE, signature)).toBe("unverifiable");
  });
});
