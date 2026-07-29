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

export function canonicalizeName(input: string): string {
  if (!input.endsWith(ARCH_SUFFIX)) {
    throw new AnsError("InvalidSuffix");
  }
  const label = input.slice(0, -ARCH_SUFFIX.length);
  validateLabel(label);
  return `${label}${ARCH_SUFFIX}`;
}

export function nameHash(input: string): Uint8Array {
  return hashName(canonicalizeName(input));
}
