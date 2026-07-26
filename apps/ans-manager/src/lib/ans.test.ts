import { describe, expect, it } from "vitest";
import { canonicalizeName } from "@arch-network/ans-sdk";
import { encodeArchAddress, decodeArchAddress } from "./ans";

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
});
