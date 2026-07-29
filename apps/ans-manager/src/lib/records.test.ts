import { describe, expect, it } from "vitest";

import {
  TEXT_RECORD_CATALOG,
  buildProfileRows,
  groupProfileRows,
  nextOpenEditor,
  validateDraft,
} from "./records";
import { recordIconSpec } from "./record-icons";

describe("profile record rows", () => {
  it("groups Arch, payments, web, profile, and social records", () => {
    const rows = buildProfileRows({
      ownerDisplay: "Owner111",
      primaryName: null,
      canonicalName: "alice.arch",
      archOwnerRevision: 1n,
      taprootDisplay: null,
      taprootRevision: 0n,
      textByKey: {},
    });
    expect(rows.some((row) => row.kind === "arch-owner")).toBe(true);
    expect(rows.some((row) => row.kind === "primary")).toBe(true);
    expect(rows.some((row) => row.kind === "bitcoin-taproot")).toBe(true);
    expect(rows.some((row) => row.kind === "token-ata")).toBe(false);
    const eth = rows.find((row) => row.textKey === "eth");
    expect(eth).toBeTruthy();
    expect(eth?.writable).toBe(true);
    expect(eth?.gateReason).toBeNull();
    expect(groupProfileRows(rows).map((group) => group.id)).toEqual([
      "priority",
      "payments",
      "web",
      "profile",
      "social",
    ]);
  });

  it("keeps user-facing row copy free of implementation and competitor jargon", () => {
    const rows = buildProfileRows({
      ownerDisplay: null,
      primaryName: null,
      canonicalName: "alice.arch",
      archOwnerRevision: 0n,
      taprootDisplay: null,
      taprootRevision: 0n,
      textByKey: {},
    });
    const copy = rows
      .flatMap((row) => [row.label, row.description, row.gateReason])
      .filter(Boolean)
      .join(" ");
    expect(copy).not.toMatch(/SNS|Solana Name Service|tokenPrograms|parity/i);
  });

  it("opens only one record editor at a time", () => {
    expect(nextOpenEditor(null, "text:eth")).toBe("text:eth");
    expect(nextOpenEditor("text:eth", "text:url")).toBe("text:url");
    expect(nextOpenEditor("text:url", "text:url")).toBeNull();
  });

  it("validates drafts for text rows", () => {
    const rows = buildProfileRows({
      ownerDisplay: null,
      primaryName: null,
      canonicalName: "alice.arch",
      archOwnerRevision: 0n,
      taprootDisplay: null,
      taprootRevision: 0n,
      textByKey: {},
    });
    const eth = rows.find((row) => row.textKey === "eth")!;
    expect(validateDraft(eth, "0x" + "aa".repeat(20))).toBeNull();
    expect(validateDraft(eth, "nope")).toMatch(/0x/);
  });

  it("assigns an icon to every visible catalog record", () => {
    const recordIds = [
      "arch-owner",
      "primary",
      "bitcoin-taproot",
      ...TEXT_RECORD_CATALOG.map((record) => record.key),
    ];

    for (const recordId of recordIds) {
      expect(recordIconSpec(recordId).icon, recordId).not.toBe("fallback");
    }
  });
});
