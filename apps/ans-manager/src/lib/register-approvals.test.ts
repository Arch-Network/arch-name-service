import { describe, expect, it } from "vitest";
import { registrationApprovalCopy } from "./register-approvals";

describe("registration approval copy", () => {
  it("sets expectations before account setup is known", () => {
    const copy = registrationApprovalCopy(null, "brian.arch");

    expect(copy.heading).toBe("Usually 1 approval");
    expect(copy.detail).toMatch(/first on-chain action/i);
    expect(copy.detail).toMatch(/setup first.*name registration/i);
  });

  it("labels both first-time account approvals specifically", () => {
    expect(
      registrationApprovalCopy(
        { phase: "account-setup", approvalIndex: 1, approvalTotal: 2, attempt: 1 },
        "brian.arch",
      ).heading,
    ).toBe("Approval 1 of 2 — create your Arch account");

    expect(
      registrationApprovalCopy(
        { phase: "mutation", approvalIndex: 2, approvalTotal: 2, attempt: 1 },
        "brian.arch",
      ).heading,
    ).toBe("Approval 2 of 2 — register brian.arch");
  });

  it("shows one approval for an existing account", () => {
    const copy = registrationApprovalCopy(
      { phase: "mutation", approvalIndex: 1, approvalTotal: 1, attempt: 1 },
      "brian.arch",
    );

    expect(copy.heading).toBe("1 approval — register brian.arch");
  });

  it("explains a rebuilt registration without implying submission", () => {
    const copy = registrationApprovalCopy(
      { phase: "mutation", approvalIndex: 1, approvalTotal: 1, attempt: 2 },
      "brian.arch",
    );

    expect(copy.heading).toBe(
      "One more approval — Arch Wallet used a different active account",
    );
    expect(copy.detail).toMatch(/first signature was discarded/i);
    expect(copy.detail).toMatch(/nothing was submitted/i);
  });
});
