import { describe, expect, it } from "vitest";
import { AnsError, canonicalizeName } from "@arch-network/ans-sdk";
import { decodeArchAddress, encodeArchAddress, formatRegistrationError } from "./ans";

describe("ans manager helpers", () => {
  it("round-trips hex arch addresses", () => {
    const hex = "11".repeat(32);
    const bytes = decodeArchAddress(hex);
    expect(bytes.length).toBe(32);
    expect(decodeArchAddress(encodeArchAddress(bytes))).toEqual(bytes);
  });

  it("canonicalizes names for search", () => {
    expect(canonicalizeName("alice.arch")).toBe("alice.arch");
  });

  it("formats duplicate registration errors for the UI", () => {
    expect(formatRegistrationError(new AnsError("NameTaken"), "alice")).toBe(
      "alice.arch is already registered",
    );
    expect(
      formatRegistrationError(new Error("AccountAlreadyInitialized"), "bob.arch"),
    ).toBe("bob.arch is already registered");
  });
});
