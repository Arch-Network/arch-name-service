import { describe, expect, it } from "vitest";
import {
  ArchRpcError,
  TransactionPendingError,
  canonicalizeName,
} from "@arch-network/ans-sdk";
import {
  accountMismatchFromError,
  accountMismatchUserMessage,
  AnsStepError,
  approvalNotice,
  assertAnsSigningSupported,
  confirmingNotice,
  encodeArchAddress,
  decodeArchAddress,
  formatAnsMutationError,
  isSignatureMismatchError,
  isWalletAccountChangedError,
  MANAGE_ACTIONS,
  mutationFailureTitle,
  needsWalletReconnect,
  reconnectArchWallet,
  UnsupportedWalletKindError,
  WalletAccountChangedError,
} from "./ans";
import { explorerUrl, truncateMiddle } from "./explorer";
import {
  labelFromCanonical,
  parseRegisterLabelParam,
  registerPathForLabel,
} from "./register-handoff";

/** A mid-flow switch, which is the only shape this error is raised in. */
function accountChanged(previous: string, current: string) {
  return new WalletAccountChangedError({
    previousArchAddress: previous,
    currentArchAddress: current,
    context: {
      pinSource: "reported",
      pinnedAt: Date.now(),
      approvalsCompleted: 1,
      checkpoint: "attempt-1-approval-2-of-2",
    },
  });
}

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

  it("builds testnet explorer tx and account URLs", () => {
    expect(explorerUrl({ kind: "tx", value: "abc" })).toBe(
      "https://explorer.arch.network/testnet/tx/abc",
    );
    expect(explorerUrl({ kind: "account", value: "ArchAddr1" })).toBe(
      "https://explorer.arch.network/testnet/accounts/ArchAddr1",
    );
  });

  it("builds mainnet explorer URLs without /testnet prefix", () => {
    expect(explorerUrl({ kind: "tx", value: "abc", network: "mainnet" })).toBe(
      "https://explorer.arch.network/tx/abc",
    );
    expect(
      explorerUrl({ kind: "account", value: "ArchAddr1", network: "mainnet" }),
    ).toBe("https://explorer.arch.network/accounts/ArchAddr1");
  });

  it("truncates long values in the middle", () => {
    expect(truncateMiddle("abcdefghijklmnop", 4, 4)).toBe("abcd…mnop");
  });

  it("tells the user to switch the wallet's active account, not to reconnect", () => {
    const message = formatAnsMutationError(new Error("error checking transaction sigs"));
    // Reconnecting rebinds the site to an account; it does not change which
    // key the released extension signs with, so it must not be suggested.
    expect(message).not.toMatch(/reconnect/i);
    expect(message).toMatch(/active account/i);
    expect(message).toMatch(/nothing changed on-chain/i);
    expect(message).not.toMatch(/turnkey/i);
    expect(message).not.toMatch(/linked external/i);
    expect(message).not.toBe("error checking transaction sigs");
    expect(isSignatureMismatchError(new Error("error checking transaction sigs"))).toBe(true);
    expect(needsWalletReconnect(new Error("error checking transaction sigs"))).toBe(true);
  });

  /**
   * This copy used to blame a stale deployment and tell the user to refresh,
   * which sent people in circles. A -32602 that is *not* the un-indexed
   * signature means the endpoint's contract moved, so the advice points at the
   * operator.
   */
  it("blames the endpoint contract, not the deploy, for invalid params", () => {
    const message = formatAnsMutationError(
      new ArchRpcError("send_transaction", {
        code: -32602,
        message: "Invalid params",
        data: "invalid type: map, expected u32 at line 1 column 1",
      }),
    );
    expect(message).toMatch(/send_transaction/);
    expect(message).toMatch(/request format changed/i);
    expect(message).toMatch(/nothing was registered/i);
    expect(message).not.toMatch(/redeploy/i);
    expect(message).not.toMatch(/refresh/i);
    expect(message).not.toMatch(/faucet rejected/i);
  });

  /**
   * The byte-exact body the user's network tab captured on a set-primary that
   * had already succeeded on-chain. Reading it as a broken endpoint contract
   * printed a JSON-RPC dump and told them retrying would not help — both
   * wrong, and both about a transaction that had landed.
   */
  it("never reports the un-indexed reply as a broken endpoint contract", () => {
    const notIndexed = new ArchRpcError("get_processed_transaction", {
      code: -32602,
      message: "Invalid params",
      data: "invalid type: sequence, expected a string at line 1 column 0",
    });

    for (const error of [
      notIndexed,
      // Every layer this can arrive wrapped in on the way to the UI.
      new AnsStepError("mutation", null, notIndexed),
      new Error(notIndexed.message),
      new Error("confirmation gave up", { cause: notIndexed }),
    ]) {
      const message = formatAnsMutationError(error);
      expect(message).not.toMatch(/request format changed/i);
      expect(message).not.toMatch(/retrying will not help/i);
      expect(message).not.toMatch(/invalid type: sequence/i);
      expect(message).not.toMatch(/-32602|jsonrpc/i);
      expect(message).toMatch(/may have landed|may well have landed/i);
      expect(message).toMatch(/safe/i);
    }
  });

  it("says a pending transaction may still land and is safe to retry", () => {
    const message = formatAnsMutationError(
      new TransactionPendingError("cd".repeat(32), new Error("gateway timeout")),
    );
    expect(message).toMatch(/accepted/i);
    expect(message).toMatch(/safe/i);
    expect(message).not.toMatch(/failed/i);
  });

  it("keeps confirmation copy out of the way until the approvals are done", () => {
    const approving = {
      phase: "mutation" as const,
      approvalIndex: 1,
      approvalTotal: 2,
      attempt: 1,
    };
    expect(confirmingNotice(approving, "update")).toBeNull();
    expect(confirmingNotice(null, "update")).toBeNull();

    const confirming = { ...approving, stage: "confirming" as const };
    expect(confirmingNotice(confirming, "update")?.title).toMatch(
      /waiting for the network to confirm/i,
    );
    // The wallet is done asking; an approval notice here is a lie.
    expect(approvalNotice(confirming, "update")).toBeNull();
  });

  it("detects wallet account-change preflight errors", () => {
    const err = accountChanged("addrA", "addrB");
    expect(isWalletAccountChangedError(err)).toBe(true);
    expect(formatAnsMutationError(err)).toMatch(/wallet account changed/i);
    expect(needsWalletReconnect(err)).toBe(true);
    expect(isWalletAccountChangedError(new Error("Connected wallet account changed mid-flow"))).toBe(
      true,
    );
    expect(isWalletAccountChangedError(new Error("something else"))).toBe(false);
  });

  it("titles failures by the attempted action", () => {
    expect(mutationFailureTitle(MANAGE_ACTIONS.setPrimary)).toBe("Set as primary failed");
    expect(mutationFailureTitle(MANAGE_ACTIONS.setTaproot)).toBe("Update Taproot record failed");
    expect(mutationFailureTitle(null)).toBe("Update failed");
  });

  it("explains account mismatch in plain language with a retry hint", () => {
    const generic = accountMismatchUserMessage(MANAGE_ACTIONS.setPrimary);
    expect(generic).toMatch(/Set as primary again/i);
    expect(generic).toMatch(/nothing was signed/i);
    expect(generic).not.toMatch(/turnkey/i);
  });

  it("names both accounts when the mismatch is known", () => {
    const mismatch = accountMismatchFromError(
      accountChanged("11".repeat(32), "22".repeat(32)),
    );
    expect(mismatch).not.toBeNull();
    const message = accountMismatchUserMessage(MANAGE_ACTIONS.setPrimary, mismatch);
    expect(message).toContain(mismatch!.pinnedShort);
    expect(message).toContain(mismatch!.currentShort);
    expect(message).toMatch(/no funds\s+moved/i);
  });

  it("puts both identities in the technical details of the error itself", () => {
    const err = accountChanged("11".repeat(32), "22".repeat(32));
    expect(err.message).toContain("11".repeat(4));
    expect(err.message).toContain("22".repeat(4));
    expect(err.message).toMatch(/nothing was submitted/i);
  });

  it("blocks linked-external / watch accounts before signing when kind is known", () => {
    expect(() => assertAnsSigningSupported({ kind: "external" })).toThrow(
      UnsupportedWalletKindError,
    );
    expect(() => assertAnsSigningSupported({ kind: "watch" })).toThrow(UnsupportedWalletKindError);
    expect(() => assertAnsSigningSupported({ kind: "turnkey" })).not.toThrow();
    expect(() => assertAnsSigningSupported({})).not.toThrow();
  });
});

describe("reconnectArchWallet", () => {
  const TURNKEY = {
    address: "tb1pa",
    publicKey: "02".padEnd(66, "a"),
    archAddress: "11".repeat(32),
    kind: "turnkey",
  };

  function installWallet(overrides: Record<string, unknown>) {
    const calls: string[] = [];
    (globalThis as unknown as { window: Record<string, unknown> }).window ??= {};
    (window as unknown as { arch: unknown }).arch = {
      getAccount: async () => {
        calls.push("getAccount");
        return null;
      },
      disconnect: async () => {
        calls.push("disconnect");
      },
      connect: async () => {
        calls.push("connect");
        return TURNKEY;
      },
      ...overrides,
    };
    return calls;
  }

  it("adopts the currently connected account without prompting", async () => {
    const calls = installWallet({ getAccount: async () => TURNKEY });

    await expect(reconnectArchWallet()).resolves.toMatchObject({
      archAddress: TURNKEY.archAddress,
    });
    expect(calls).not.toContain("disconnect");
    expect(calls).not.toContain("connect");
  });

  it("drops the connection when the bound account cannot sign ANS mutations", async () => {
    const calls = installWallet({
      getAccount: async () => ({ ...TURNKEY, kind: "watch" }),
    });

    await expect(reconnectArchWallet()).resolves.toMatchObject({ kind: "turnkey" });
    expect(calls).toEqual(["disconnect", "connect"]);
  });

  it("prompts when the site is no longer connected", async () => {
    const calls = installWallet({
      getAccount: async () => {
        throw new Error("Site not connected");
      },
    });

    await expect(reconnectArchWallet()).resolves.toMatchObject({ kind: "turnkey" });
    expect(calls).toEqual(["disconnect", "connect"]);
  });
});

describe("register handoff", () => {
  it("extracts labels from canonical names", () => {
    expect(labelFromCanonical("satoshi.arch")).toBe("satoshi");
  });

  it("parses label and canonical query values", () => {
    expect(parseRegisterLabelParam("satoshi")).toBe("satoshi");
    expect(parseRegisterLabelParam("Satoshi.Arch")).toBe("satoshi");
    expect(parseRegisterLabelParam("  alice.arch ")).toBe("alice");
  });

  it("rejects invalid or empty handoff values", () => {
    expect(parseRegisterLabelParam(null)).toBeNull();
    expect(parseRegisterLabelParam("")).toBeNull();
    expect(parseRegisterLabelParam("-bad")).toBeNull();
    expect(parseRegisterLabelParam("Bad_Label")).toBeNull();
    expect(parseRegisterLabelParam("not.arch.network")).toBeNull();
  });

  it("builds a Register deep-link path", () => {
    expect(registerPathForLabel("satoshi.arch")).toBe("/register?label=satoshi");
    expect(registerPathForLabel("-bad")).toBe("/register");
  });
});
