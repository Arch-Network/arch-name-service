/**
 * Local verification of the signatures Arch Wallet returns.
 *
 * Why this module exists
 * ----------------------
 * The released extension resolves two different accounts for two
 * different questions. `getAccount()` answers "which account is this
 * origin connected to" (`connectedSites[origin].accountId`), while the
 * Approve window signs with whatever account is *active* in the wallet
 * — the sign path never looks at the origin binding. When those two
 * disagree, the page builds a transaction whose fee payer is account A
 * and hands the node a signature made by account B, and the only place
 * that discrepancy surfaces is `send_transaction`, as "error checking
 * transaction sigs", after the user has already approved.
 *
 * A page cannot change the extension, but it *can* check the signature
 * before it submits. Doing so turns a post-approval node rejection into
 * something the app can act on: identify who actually signed, rebuild
 * around that account, and never put an unverifiable transaction on the
 * wire.
 *
 * What Arch actually verifies
 * ---------------------------
 * The fee payer is a 32-byte x-only key P (the *untweaked* BIP-86
 * internal key — that is what `archAddress` encodes). The wallet signs
 * the BIP-322 `to_sign` taproot key-path sighash for the P2TR output of
 * P, over the 64-char lowercase hex string of the SanitizedMessage hash
 * taken as UTF-8 bytes, with SIGHASH_DEFAULT. The resulting 64-byte
 * BIP-340 signature verifies against the *tweaked* output key
 * Q = P + H_TapTweak(P)·G.
 *
 * The digests produced here are pinned against the extension's own
 * bip322-js implementation in `bip322.test.ts`.
 */

import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { canonicalArchKey } from "./arch-identity";

const { taggedHash, lift_x, pointToBytes } = schnorr.utils;

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function uint32LE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function uint64LE(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

/** Bitcoin compact size. Every script here is far below the 0xfd cutoff. */
function compactSize(value: number): Uint8Array {
  if (value < 0xfd) return Uint8Array.of(value);
  throw new Error(`compactSize: ${value} is out of range for BIP-322 framing`);
}

function withLength(script: Uint8Array): Uint8Array {
  return concatBytes(compactSize(script.length), script);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

/**
 * BIP-86 key-path output key: Q = P + int(H_TapTweak(P))·G, x-only.
 *
 * No script tree, which is what every wallet account here uses, so the
 * tweak commits to nothing but the internal key itself.
 */
export function taprootOutputKey(internalXOnly: Uint8Array): Uint8Array {
  const tweak = bytesToBigInt(taggedHash("TapTweak", internalXOnly));
  const internalPoint = lift_x(bytesToBigInt(internalXOnly));
  return pointToBytes(internalPoint.add(schnorr.Point.BASE.multiply(tweak)));
}

/** `OP_1 <32-byte output key>` — the P2TR scriptPubKey, network-agnostic. */
export function p2trScriptPubKey(outputKey: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(0x51, 0x20), outputKey);
}

/**
 * Txid (internal byte order) of the BIP-322 `to_spend` transaction.
 *
 * Consensus-serialized with no witness, per BIP-322: one input spending
 * a null outpoint with `OP_0 PUSH32 <tagged message hash>` as its
 * scriptSig, one zero-value output paying the message challenge.
 */
function toSpendTxid(messageBytes: Uint8Array, scriptPubKey: Uint8Array): Uint8Array {
  const messageHash = taggedHash("BIP0322-signed-message", messageBytes);
  const scriptSig = concatBytes(Uint8Array.of(0x00, 0x20), messageHash);
  const serialized = concatBytes(
    uint32LE(0), // nVersion
    compactSize(1),
    new Uint8Array(32), // null prevout hash
    uint32LE(0xffffffff), // null prevout index
    withLength(scriptSig),
    uint32LE(0), // nSequence
    compactSize(1),
    uint64LE(0), // nValue
    withLength(scriptPubKey),
    uint32LE(0), // nLockTime
  );
  return sha256(sha256(serialized));
}

/**
 * The 32-byte digest the wallet's Turnkey signer actually signs.
 *
 * BIP-341 key-path SigMsg for input 0 of the BIP-322 `to_sign`
 * transaction, SIGHASH_DEFAULT, no annex.
 */
export function bip322TaprootSighash(
  outputKey: Uint8Array,
  message: string,
): Uint8Array {
  const scriptPubKey = p2trScriptPubKey(outputKey);
  const messageBytes = new TextEncoder().encode(message);
  const prevoutTxid = toSpendTxid(messageBytes, scriptPubKey);

  const shaPrevouts = sha256(concatBytes(prevoutTxid, uint32LE(0)));
  const shaAmounts = sha256(uint64LE(0));
  const shaScriptPubKeys = sha256(withLength(scriptPubKey));
  const shaSequences = sha256(uint32LE(0));
  // The single `to_sign` output is a bare OP_RETURN carrying nothing.
  const shaOutputs = sha256(concatBytes(uint64LE(0), withLength(Uint8Array.of(0x6a))));

  const sigMsg = concatBytes(
    Uint8Array.of(0x00), // hash_type: SIGHASH_DEFAULT
    uint32LE(0), // nVersion
    uint32LE(0), // nLockTime
    shaPrevouts,
    shaAmounts,
    shaScriptPubKeys,
    shaSequences,
    shaOutputs,
    Uint8Array.of(0x00), // spend_type: key path, no annex
    uint32LE(0), // input_index
  );
  // The leading zero byte is BIP-341's sighash epoch, not part of SigMsg.
  return taggedHash("TapSighash", concatBytes(Uint8Array.of(0x00), sigMsg));
}

/**
 * Three-valued on purpose.
 *
 * `unverifiable` is not a soft "invalid": it means this build could not
 * evaluate the question at all (a signature shape we do not model, a key
 * we cannot decode). Only `mismatch` is evidence that the wallet signed
 * with a different account, and only `mismatch` is allowed to stop a
 * submission — a verifier that cannot parse something must never be the
 * reason a legitimate registration fails.
 */
export type SignatureCheck = "match" | "mismatch" | "unverifiable";

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().replace(/^0[xX]/, "");
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Did `archAddress` produce `signature64Hex` over `messageHashHex`?
 *
 * @param archAddress Any encoding an Arch account arrives in.
 * @param messageHashHex The 64-char lowercase hex the wallet was handed.
 * @param signature64Hex 64-byte (r||s) BIP-340 signature as hex.
 */
export function checkArchSignature(
  archAddress: string | null | undefined,
  messageHashHex: string,
  signature64Hex: string,
): SignatureCheck {
  const internal = canonicalArchKey(archAddress);
  if (!internal) return "unverifiable";
  const signature = hexToBytes(signature64Hex);
  // 65-byte signatures carry a trailing non-default SIGHASH byte, which
  // implies a digest this function does not compute. Say so rather than
  // reporting a mismatch we did not actually establish.
  if (!signature || signature.length !== 64) return "unverifiable";
  if (!/^[0-9a-f]{64}$/i.test(messageHashHex.trim())) return "unverifiable";

  try {
    const outputKey = taprootOutputKey(internal);
    const digest = bip322TaprootSighash(outputKey, messageHashHex.trim().toLowerCase());
    return schnorr.verify(signature, digest, outputKey) ? "match" : "mismatch";
  } catch {
    return "unverifiable";
  }
}
