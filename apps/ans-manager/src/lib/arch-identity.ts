/**
 * Canonical form for an Arch account identity.
 *
 * An Arch account is a 32-byte x-only public key, but it reaches this app
 * in several superficially different shapes: base58 (what the wallet's
 * `getAccount()` returns), lowercase or uppercase hex (what the RPC and
 * some tooling use), with or without an `0x` prefix, and occasionally as a
 * 33-byte compressed secp256k1 key whose leading `02`/`03` parity byte is
 * not part of the Arch identity at all.
 *
 * Comparing those as display strings makes two encodings of the SAME key
 * look like an account switch, which aborts a mutation the user could
 * have completed. Every equality check therefore goes through the 32-byte
 * form, and only a genuinely different key counts as a change.
 */

import bs58 from "bs58";

/** Hex is only assumed for the two lengths a key can legitimately have. */
const HEX_KEY = /^(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{66})$/;

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
}

function bytesFromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Decode any accepted encoding to the 32-byte x-only Arch account key, or
 * null when the value is not a recognizable Arch identity.
 */
export function canonicalArchKey(value: string | null | undefined): Uint8Array | null {
  if (typeof value !== "string") return null;
  const trimmed = stripHexPrefix(value.trim());
  if (!trimmed) return null;

  let bytes: Uint8Array;
  if (HEX_KEY.test(trimmed)) {
    bytes = bytesFromHex(trimmed);
  } else {
    try {
      bytes = bs58.decode(trimmed);
    } catch {
      return null;
    }
  }

  // A compressed secp256k1 key carries a parity byte the Arch account
  // identity does not: `02aabb…` and `aabb…` are the same account.
  if (bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03)) {
    bytes = bytes.slice(1);
  }
  return bytes.length === 32 ? bytes : null;
}

/** Lowercase 64-char hex of the x-only key, or null. */
export function canonicalArchKeyHex(value: string | null | undefined): string | null {
  const bytes = canonicalArchKey(value);
  if (!bytes) return null;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * True when two values name the same Arch signing key, whatever encoding
 * each one arrived in.
 *
 * Values we cannot canonicalize fall back to an exact trimmed comparison:
 * that keeps an unrecognized-but-identical pair from reading as a change,
 * while still refusing to call two unknown values equal.
 */
export function archIdentitiesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = canonicalArchKeyHex(a);
  const right = canonicalArchKeyHex(b);
  if (left && right) return left === right;
  if (typeof a !== "string" || typeof b !== "string") return false;
  return a.trim() === b.trim();
}

/** `9xKf…4T2q` — enough for a human to tell two accounts apart. */
export function shortArchAddress(
  value: string | null | undefined,
  chars = 6,
): string {
  if (typeof value !== "string" || !value.trim()) return "unknown account";
  const trimmed = value.trim();
  if (trimmed.length <= chars * 2 + 1) return trimmed;
  return `${trimmed.slice(0, chars)}…${trimmed.slice(-chars)}`;
}

/**
 * Support-grade identity line: the address as the wallet reports it plus
 * the canonical key, so a mismatch report says which key was involved even
 * when the two sides printed different encodings.
 */
export function archIdentityFingerprint(value: string | null | undefined): string {
  const hex = canonicalArchKeyHex(value);
  const shown = typeof value === "string" && value.trim() ? value.trim() : "none";
  if (!hex) return `${shown} (unrecognized encoding)`;
  return `${shown} (key ${hex.slice(0, 8)}…${hex.slice(-8)})`;
}
