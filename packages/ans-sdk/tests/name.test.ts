import { describe, expect, it } from "vitest";
import {
  AnsError,
  buildRegisterInstruction,
  canonicalizeLabel,
  canonicalizeName,
  decodeInstruction,
  nameHash,
  validateLabel,
} from "../src/index.js";

const PROGRAM_ID = new Uint8Array(32).fill(7);
const OWNER = new Uint8Array(32).fill(2);
const REGISTRY_CONFIG = new Uint8Array(32).fill(3);

describe("canonicalizeName", () => {
  /** The namespace is lowercase-only, so a capitalized name is the same name. */
  it("folds case and trims", () => {
    expect(canonicalizeName("Adams.arch")).toBe("adams.arch");
    expect(canonicalizeName("ADAMS.ARCH")).toBe("adams.arch");
    expect(canonicalizeName("  Adams.arch  ")).toBe("adams.arch");
    expect(canonicalizeName("adams.arch")).toBe("adams.arch");
  });

  it("hashes every spelling of a name to the same value", () => {
    expect(nameHash("Adams.arch")).toEqual(nameHash("adams.arch"));
    expect(nameHash("ADAMS.ARCH")).toEqual(nameHash("adams.arch"));
  });

  it("still rejects characters that cannot appear in a label", () => {
    expect(() => canonicalizeName("ad_ams.arch")).toThrow(AnsError);
    expect(() => canonicalizeName("ad ams.arch")).toThrow(AnsError);
    expect(() => canonicalizeName("-adams.arch")).toThrow(AnsError);
    expect(() => canonicalizeName("ad--ams.arch")).toThrow(AnsError);
    expect(() => canonicalizeName(".arch")).toThrow(AnsError);
    expect(() => canonicalizeName("adams")).toThrow(AnsError);
    expect(() => canonicalizeName("adams.eth")).toThrow(AnsError);
  });

  /**
   * Case folding must not widen the character set: anything that does not fold
   * to plain ASCII has to stay rejected.
   */
  it("rejects non-ASCII that survives lowercasing", () => {
    expect(() => canonicalizeName("adamś.arch")).toThrow(AnsError);
    expect(() => canonicalizeName("аdams.arch")).toThrow(AnsError); // Cyrillic а
  });

  it("leaves validateLabel strict, since it checks a stored label", () => {
    expect(() => validateLabel("Adams")).toThrow(AnsError);
    expect(() => validateLabel("adams")).not.toThrow();
  });
});

describe("canonicalizeLabel", () => {
  it("returns the stored label for any accepted spelling", () => {
    expect(canonicalizeLabel("Adams")).toBe("adams");
    expect(canonicalizeLabel(" adams ")).toBe("adams");
    expect(() => canonicalizeLabel("ad_ams")).toThrow(AnsError);
  });
});

describe("buildRegisterInstruction", () => {
  /**
   * The PDA and the encoded label must agree, or the program rejects an
   * instruction whose account was derived from a different name.
   */
  it("registers the canonical label whatever case was typed", () => {
    const mixed = buildRegisterInstruction({
      programId: PROGRAM_ID,
      owner: OWNER,
      registryConfig: REGISTRY_CONFIG,
      namespace: ".arch",
      label: "Adams",
    });
    const lower = buildRegisterInstruction({
      programId: PROGRAM_ID,
      owner: OWNER,
      registryConfig: REGISTRY_CONFIG,
      namespace: ".arch",
      label: "adams",
    });

    const decoded = decodeInstruction(mixed.data);
    expect(decoded.kind === "Register" && decoded.label).toBe("adams");
    expect(mixed.data).toEqual(lower.data);
    expect(mixed.accounts.map((a) => a.pubkey)).toEqual(
      lower.accounts.map((a) => a.pubkey),
    );
  });
});
