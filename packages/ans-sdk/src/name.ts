import { ARCH_SUFFIX } from "./constants.js";
import { AnsError } from "./errors.js";
import { hashName } from "./hash.js";

export function validateLabel(label: string): void {
  if (label.length < 1 || label.length > 63) {
    throw new AnsError("InvalidLabelLength");
  }
  if (label.startsWith("-") || label.endsWith("-") || label.includes("--")) {
    throw new AnsError("InvalidHyphenPlacement");
  }
  for (const byte of new TextEncoder().encode(label)) {
    const isLower = byte >= 0x61 && byte <= 0x7a;
    const isDigit = byte >= 0x30 && byte <= 0x39;
    if (!isLower && !isDigit && byte !== 0x2d) {
      throw new AnsError("InvalidLabelCharacter");
    }
  }
}

/**
 * Normalize a `.arch` name to the single form that can exist on chain.
 *
 * The namespace is lowercase-only, like DNS: `Adams.arch` and `adams.arch` are
 * the same name, and only `adams.arch` is storable. Case folding therefore
 * belongs here, not at each call site — resolution used to reject any input a
 * user had capitalized. `validateLabel` stays strict because it checks a label
 * as stored, and the program must keep rejecting non-canonical input.
 */
export function canonicalizeName(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized.endsWith(ARCH_SUFFIX)) {
    throw new AnsError("InvalidSuffix");
  }
  const label = normalized.slice(0, -ARCH_SUFFIX.length);
  validateLabel(label);
  return `${label}${ARCH_SUFFIX}`;
}

/** The canonical label (no suffix) for any accepted spelling of a name. */
export function canonicalizeLabel(label: string): string {
  return canonicalizeName(`${label.trim()}${ARCH_SUFFIX}`).slice(0, -ARCH_SUFFIX.length);
}

export function nameHash(input: string): Uint8Array {
  return hashName(canonicalizeName(input));
}
