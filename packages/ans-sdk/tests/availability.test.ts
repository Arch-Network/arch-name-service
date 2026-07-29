import { describe, expect, it } from "vitest";
import {
  classifyNameAccountData,
  isBlankAccountData,
  isDuplicateRegistrationErrorMessage,
} from "../src/availability.js";
import {
  encodeNameAccount,
  initializedHeader,
  NAME_ACCOUNT_DISCRIMINATOR,
} from "../src/codec/state.js";
import type { NameAccount } from "../src/types.js";

function sampleName(initialized = true): NameAccount {
  return {
    header: {
      ...initializedHeader(NAME_ACCOUNT_DISCRIMINATOR),
      initialized,
    },
    nameHash: new Uint8Array(32).fill(1),
    canonicalLabel: "alice",
    owner: new Uint8Array(32).fill(2),
    registeredAtSlot: 0n,
    expiresAtSlot: 0xffff_ffff_ffff_ffffn,
    recordEpoch: 1n,
    primaryBindingNonce: 0n,
  };
}

describe("name availability classification", () => {
  it("treats missing, empty, and zeroed data as available", () => {
    expect(classifyNameAccountData(null).availability).toBe("available");
    expect(classifyNameAccountData(new Uint8Array()).availability).toBe("available");
    expect(classifyNameAccountData(new Uint8Array(64)).availability).toBe("available");
    expect(isBlankAccountData(new Uint8Array(16))).toBe(true);
  });

  it("treats initialized name accounts as taken", () => {
    const bytes = encodeNameAccount(sampleName(true));
    const classified = classifyNameAccountData(bytes);
    expect(classified.availability).toBe("taken");
    expect(classified.account?.canonicalLabel).toBe("alice");
  });

  it("rejects non-blank junk as unavailable", () => {
    expect(classifyNameAccountData(new Uint8Array(32).fill(7)).availability).toBe(
      "unavailable",
    );
  });

  it("does not treat uninitialized headers as taken", () => {
    const bytes = encodeNameAccount(sampleName(false));
    expect(classifyNameAccountData(bytes).availability).toBe("unavailable");
  });

  it("detects on-chain duplicate registration error strings", () => {
    expect(isDuplicateRegistrationErrorMessage("AccountAlreadyInitialized")).toBe(true);
    expect(isDuplicateRegistrationErrorMessage("custom boom")).toBe(false);
  });
});
