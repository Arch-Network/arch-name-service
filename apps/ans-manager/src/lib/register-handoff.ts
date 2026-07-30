import { canonicalizeName, validateLabel } from "@arch-network/ans-sdk";

const ARCH_SUFFIX = ".arch";

/** Extract the label from a validated canonical name (`alice.arch` → `alice`). */
export function labelFromCanonical(canonical: string): string {
  const normalized = canonicalizeName(canonical);
  return normalized.slice(0, -ARCH_SUFFIX.length);
}

/**
 * Normalize a register deep-link / Search handoff value into a validated label.
 * Accepts `alice` or `alice.arch`. Returns null when missing or invalid so
 * stale/garbage query params never prefill Register.
 */
export function parseRegisterLabelParam(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    if (trimmed.endsWith(ARCH_SUFFIX)) {
      return labelFromCanonical(canonicalizeName(trimmed));
    }
    validateLabel(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

/** Build the Register route with an optional validated label query param. */
export function registerPathForLabel(labelOrCanonical: string): string {
  const parsed = parseRegisterLabelParam(labelOrCanonical);
  if (!parsed) return "/register";
  return `/register?label=${encodeURIComponent(parsed)}`;
}
