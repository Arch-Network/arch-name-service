import { describe, expect, it } from "vitest";
import { AnsStepError, UnsupportedWalletKindError, WalletAccountChangedError } from "./ans";
import { classifyWalletBlocker, walletBlockerNotice } from "./wallet-state";

describe("classifyWalletBlocker", () => {
  it("classifies the extension's locked-wallet error", () => {
    expect(classifyWalletBlocker(new Error("Wallet locked"))).toBe("locked");
    expect(classifyWalletBlocker(new Error("Keystore is locked"))).toBe("locked");
  });

  it("classifies an unconnected origin", () => {
    expect(classifyWalletBlocker(new Error("Site not connected"))).toBe("not_connected");
  });

  it("classifies states that need a fresh site connection", () => {
    expect(
      classifyWalletBlocker(new WalletAccountChangedError({
        previousArchAddress: "addrA",
        currentArchAddress: "addrB",
        context: {
          pinSource: "reported",
          pinnedAt: Date.now(),
          approvalsCompleted: 1,
          checkpoint: "attempt-1-approval-2-of-2",
        },
      })),
    ).toBe("needs_reconnect");
    expect(
      classifyWalletBlocker(
        new Error("The connected site account is no longer available. Reconnect the site."),
      ),
    ).toBe("needs_reconnect");
  });

  it("classifies a node-side signature-check failure as a signer mismatch", () => {
    // Not `needs_reconnect`: the released extension picks the signing
    // account from the wallet's active account, so reconnecting the site
    // would send the user through an approval that changes nothing.
    expect(classifyWalletBlocker(new Error("error checking transaction sigs"))).toBe(
      "signer_mismatch",
    );
    expect(
      classifyWalletBlocker(new Error("BIP322 signature verification failed")),
    ).toBe("signer_mismatch");
  });

  it("classifies wallet kinds that cannot sign ANS transactions", () => {
    expect(classifyWalletBlocker(new UnsupportedWalletKindError("watch"))).toBe(
      "unsupported_kind",
    );
    expect(
      classifyWalletBlocker(
        new Error("Linked external wallets cannot sign Arch message hashes yet."),
      ),
    ).toBe("unsupported_kind");
  });

  it("classifies a dead extension context as needing a page refresh", () => {
    expect(classifyWalletBlocker(new Error("Extension context invalidated."))).toBe(
      "stale_extension",
    );
    expect(
      classifyWalletBlocker(new Error("Attempting to use a disconnected port object")),
    ).toBe("stale_extension");
    expect(
      classifyWalletBlocker(
        new Error("Could not establish connection. Receiving end does not exist."),
      ),
    ).toBe("stale_extension");
    expect(
      classifyWalletBlocker(
        new Error("The message port closed before a response was received."),
      ),
    ).toBe("stale_extension");
  });

  it("classifies a dead context reported through a submit step wrapper", () => {
    expect(
      classifyWalletBlocker(
        new AnsStepError("mutation", null, new Error("Extension context invalidated.")),
      ),
    ).toBe("stale_extension");
  });

  it("leaves unrelated failures unclassified", () => {
    expect(classifyWalletBlocker(new Error("Arch faucet HTTP 502"))).toBeNull();
    expect(classifyWalletBlocker(null)).toBeNull();
  });
});

describe("walletBlockerNotice", () => {
  it("offers unlock for a locked wallet and names the retry action", () => {
    const notice = walletBlockerNotice("locked", "Set as primary");
    expect(notice.action).toBe("unlock");
    expect(notice.message).toContain("Set as primary");
  });

  it("offers connect for an unconnected origin", () => {
    expect(walletBlockerNotice("not_connected", "Register").action).toBe("connect");
  });

  it("names both accounts and leads with adopting the current one", () => {
    const notice = walletBlockerNotice("needs_reconnect", "Register", {
      pinnedShort: "9xKf…4T2q",
      currentShort: "7bQr…1Zm8",
      currentKind: "turnkey",
    });
    expect(notice.action).toBe("adopt");
    expect(notice.actionLabel).toContain("7bQr…1Zm8");
    expect(notice.secondaryAction).toBe("reconnect");
    expect(notice.message).toContain("9xKf…4T2q");
    expect(notice.message).toContain("7bQr…1Zm8");
    expect(notice.message).toMatch(/nothing was signed and no funds\s+moved/i);
    expect(notice.message).not.toMatch(/turnkey/i);
  });

  it("refuses to offer adoption of an account that cannot sign", () => {
    const notice = walletBlockerNotice("needs_reconnect", "Register", {
      pinnedShort: "9xKf…4T2q",
      currentShort: "7bQr…1Zm8",
      currentKind: "watch",
    });
    expect(notice.action).toBe("reconnect");
    expect(notice.message).toMatch(/watch-only/i);
  });

  it("falls back to reconnect copy when the identities are unknown", () => {
    const notice = walletBlockerNotice("needs_reconnect", "Register");
    expect(notice.action).toBe("reconnect");
    expect(notice.message).toContain("Register");
    expect(notice.message).not.toMatch(/turnkey/i);
  });

  it("names the real signer and sends the user to the wallet's active account", () => {
    const notice = walletBlockerNotice("signer_mismatch", "Register", {
      pinnedShort: "9xKf…4T2q",
      currentShort: "7bQr…1Zm8",
      signerShort: "7bQr…1Zm8",
    });
    expect(notice.title).toMatch(/signed with a different account/i);
    expect(notice.message).toContain("7bQr…1Zm8");
    expect(notice.message).toContain("9xKf…4T2q");
    expect(notice.message).toMatch(/make 9xKf…4T2q.*the active one/i);
    expect(notice.message).toMatch(/nothing was sent/i);
    // Reconnecting cannot change which key signs, so the copy has to say
    // so rather than leave it as the obvious-looking next thing to try.
    expect(notice.message).toMatch(/reconnecting will not change that/i);
    expect(notice.action).toBe("retry");
    expect(notice.secondaryAction).toBeUndefined();
  });

  it("still explains a signer mismatch when the signer is unknown", () => {
    const notice = walletBlockerNotice("signer_mismatch", "Register");
    expect(notice.message).toMatch(/does not match any account/i);
    expect(notice.message).toMatch(/the active one on its home screen/i);
    expect(notice.action).toBe("retry");
  });

  it("explains the refresh instead of blaming the action", () => {
    const notice = walletBlockerNotice("stale_extension", "Clear primary");
    expect(notice.title).toMatch(/page refresh/i);
    expect(notice.action).toBe("reload");
    expect(notice.actionLabel).toBe("Reload page");
    expect(notice.message).toMatch(/updated or reloaded/i);
    expect(notice.message).toContain("Clear primary");
  });
});
