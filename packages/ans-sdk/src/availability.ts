import {
  decodeNameAccount,
  validateHeader,
  NAME_ACCOUNT_DISCRIMINATOR,
} from "./codec/state.js";
import { AnsError } from "./errors.js";
import type { NameAccount } from "./types.js";

export type NameAvailability = "available" | "taken" | "unavailable";

export interface ClassifiedNameAccount {
  availability: NameAvailability;
  account: NameAccount | null;
}

/** Empty or zero-filled PDA data left by an incomplete create_account. */
export function isBlankAccountData(data: Uint8Array): boolean {
  if (data.length === 0) return true;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0) return false;
  }
  return true;
}

/**
 * Classify raw name-PDA bytes the same way the registry should: initialized
 * accounts are taken, blank/missing data is available, anything else is not a
 * usable registration slot.
 */
export function classifyNameAccountData(
  data: Uint8Array | null | undefined,
): ClassifiedNameAccount {
  if (!data || isBlankAccountData(data)) {
    return { availability: "available", account: null };
  }
  try {
    const account = decodeNameAccount(data);
    validateHeader(account.header, NAME_ACCOUNT_DISCRIMINATOR);
    return { availability: "taken", account };
  } catch {
    return { availability: "unavailable", account: null };
  }
}

export function duplicateRegistrationError(name: string): AnsError {
  return new AnsError("NameTaken", `${name} is already registered`);
}

export function isDuplicateRegistrationErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("accountalreadyinitialized") ||
    lower.includes("already initialized") ||
    lower.includes("already registered") ||
    lower.includes("name taken") ||
    lower.includes("nametaken")
  );
}
