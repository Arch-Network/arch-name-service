/**
 * The wallet state machine and the request queue in front of it.
 *
 * Both exist because of one report: the header showed a connected
 * address while the extension was sitting on its unlock screen, and the
 * click that followed opened wallet windows the page had not accounted
 * for. The invariants under test are therefore (a) an address is only
 * ever produced by a read that just succeeded, and (b) one user action
 * reaches the extension once.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetWalletGateway,
  isCurrentWalletPrompt,
  isWalletPromptInFlight,
  walletRequest,
} from "./wallet-gateway";
import {
  probeWalletStatus,
  startWalletConnect,
  statusAccount,
  walletCtaDisabled,
  walletStatusCta,
  type WalletStatus,
} from "./wallet-status";
import { requireConnectedArchAccount } from "./ans";
import { __resetWalletInitialization } from "./wallet-initialization";

const TURNKEY = {
  address: "tb1pa",
  publicKey: "02".padEnd(66, "a"),
  archAddress: "11".repeat(32),
  kind: "turnkey",
};

/** An account from a released extension, which reports no `kind`. */
const NO_KIND = {
  address: TURNKEY.address,
  publicKey: TURNKEY.publicKey,
  archAddress: TURNKEY.archAddress,
};

type Provider = {
  getAccount?: () => Promise<unknown>;
  connect?: () => Promise<unknown>;
  disconnect?: () => Promise<void>;
};

function installProvider(provider: Provider | null) {
  (globalThis as unknown as { window: Record<string, unknown> }).window ??= {};
  if (provider === null) {
    delete (window as unknown as { arch?: unknown }).arch;
    return;
  }
  (window as unknown as { arch: unknown }).arch = provider;
}

beforeEach(() => {
  __resetWalletGateway();
  __resetWalletInitialization();
  installProvider(null);
});

describe("probeWalletStatus", () => {
  it("reports no extension when the provider was never injected", async () => {
    await expect(probeWalletStatus()).resolves.toEqual({ state: "no_extension" });
  });

  it("reports the account the extension named", async () => {
    installProvider({ getAccount: async () => TURNKEY });
    const status = await probeWalletStatus();
    expect(status).toEqual({ state: "connected", account: TURNKEY });
  });

  it("treats an unreported account kind as signable", async () => {
    // The released extension omits `kind`. Blocking on a field it never
    // sends would make registration impossible for every current user.
    installProvider({ getAccount: async () => NO_KIND });
    const status = await probeWalletStatus();
    expect(status.state).toBe("connected");
  });

  it("separates accounts that cannot sign from ones that can", async () => {
    for (const kind of ["watch", "external"]) {
      __resetWalletGateway();
      installProvider({ getAccount: async () => ({ ...TURNKEY, kind }) });
      const status = await probeWalletStatus();
      expect(status.state).toBe("unsupported_account");
    }
  });

  it("reports locked, and produces no account, when the wallet is locked", async () => {
    installProvider({
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
    });
    const status = await probeWalletStatus();
    expect(status).toEqual({ state: "locked" });
    expect(statusAccount(status)).toBeNull();
  });

  it("reports an unconnected origin, whether rejected or answered with null", async () => {
    installProvider({
      getAccount: async () => {
        throw new Error("Site not connected");
      },
    });
    await expect(probeWalletStatus()).resolves.toEqual({ state: "not_connected" });

    __resetWalletGateway();
    installProvider({ getAccount: async () => null });
    await expect(probeWalletStatus()).resolves.toEqual({ state: "not_connected" });
  });

  it("reports a dead extension context as needing a reload", async () => {
    installProvider({
      getAccount: async () => {
        throw new Error("Extension context invalidated.");
      },
    });
    await expect(probeWalletStatus()).resolves.toEqual({ state: "stale_extension" });
  });

  it("keeps the detail of a failure it cannot classify", async () => {
    installProvider({
      getAccount: async () => {
        throw new Error("kaboom");
      },
    });
    const status = await probeWalletStatus();
    expect(status).toEqual({ state: "unavailable", detail: "kaboom" });
    expect(statusAccount(status)).toBeNull();
  });
});

describe("no state but a live read yields an address", () => {
  it("returns null for every state the extension cannot serve", () => {
    const blocked: WalletStatus[] = [
      { state: "detecting" },
      { state: "no_extension" },
      { state: "locked" },
      { state: "not_connected" },
      { state: "stale_extension" },
      { state: "unavailable", detail: "kaboom" },
      { state: "not_initialized" },
      { state: "awaiting_wallet", intent: "unlock", canReprompt: false },
      { state: "prompt_unanswered", intent: "unlock", reason: "dismissed" },
    ];
    for (const status of blocked) {
      expect(statusAccount(status)).toBeNull();
    }
  });

  it("stops showing the account as soon as the wallet locks", async () => {
    // The exact sequence from the bug report: connected, then the wallet
    // auto-locks. The next read must drop the address, not keep it.
    let locked = false;
    installProvider({
      getAccount: async () => {
        if (locked) throw new Error("Wallet locked");
        return TURNKEY;
      },
    });

    expect(statusAccount(await probeWalletStatus())).toMatchObject({
      archAddress: TURNKEY.archAddress,
    });

    locked = true;
    __resetWalletGateway();
    const after = await probeWalletStatus();
    expect(after.state).toBe("locked");
    expect(statusAccount(after)).toBeNull();
  });
});

describe("walletStatusCta", () => {
  it("offers nothing to do when the wallet can sign", () => {
    expect(walletStatusCta({ state: "connected", account: TURNKEY })).toBeNull();
  });

  it("maps each blocked state to one next step", () => {
    expect(walletStatusCta({ state: "locked" })?.action).toBe("unlock");
    expect(walletStatusCta({ state: "not_connected" })?.action).toBe("choose_wallet");
    expect(walletStatusCta({ state: "no_extension" })?.action).toBe("choose_wallet");
    expect(walletStatusCta({ state: "not_initialized" })?.action).toBe("connect");
    expect(walletStatusCta({ state: "stale_extension" })?.action).toBe("reload");
    expect(walletStatusCta({ state: "unavailable", detail: "x" })?.action).toBe("retry");
    expect(
      walletStatusCta({ state: "unsupported_account", account: { ...TURNKEY, kind: "watch" } })
        ?.action,
    ).toBe("reconnect");
  });

  it("says the wallet is locked rather than blaming the action", () => {
    const cta = walletStatusCta({ state: "locked" })!;
    expect(cta.label).toBe("Unlock Arch Wallet");
    expect(cta.message).toMatch(/nothing has been sent to the network/i);
  });

  it("offers a plain re-read for a wallet unlocked from the toolbar", () => {
    // Unlocking from the extension icon leaves this tab visible and
    // unfocused, so the page has no event to react to and re-reads on a
    // timer. This is the button for when that feels slow — and it must
    // be a read, not a second unlock prompt.
    const cta = walletStatusCta({ state: "locked" })!;
    expect(cta.secondaryAction).toBe("retry");
    expect(cta.secondaryLabel).toMatch(/check again/i);
    expect(cta.message).toMatch(/toolbar/i);
  });

  it("offers the same prompt again, never a re-read, after an unanswered one", () => {
    // The loop in the bug report: an unfinished unlock became "Check
    // wallet again", whose re-read reported `locked`, which offered
    // "Unlock Arch Wallet" — back to the start with nothing learned.
    for (const reason of ["dismissed", "timeout", "error"] as const) {
      const cta = walletStatusCta({ state: "prompt_unanswered", intent: "unlock", reason })!;
      expect(cta.action).toBe("unlock");
      expect(cta.label).toBe("Unlock Arch Wallet");
      expect(cta.label).not.toBe("Check wallet again");
    }
  });

  it("tells the three prompt failures apart in the copy", () => {
    const title = (reason: "dismissed" | "timeout" | "error") =>
      walletStatusCta({ state: "prompt_unanswered", intent: "unlock", reason })!.title;

    expect(title("dismissed")).toMatch(/closed/i);
    expect(title("timeout")).toMatch(/did not answer in time/i);
    expect(title("error")).toMatch(/could not complete/i);
    expect(new Set([title("dismissed"), title("timeout"), title("error")]).size).toBe(3);
  });

  it("says a window is waiting, and where to find it, while a prompt is open", () => {
    const cta = walletStatusCta({
      state: "awaiting_wallet",
      intent: "unlock",
      canReprompt: false,
    })!;
    expect(cta.label).toBe("Waiting for Arch Wallet…");
    expect(cta.message).toMatch(/behind this one/i);
    expect(cta.message).toMatch(/nothing has been sent to the network/i);
  });

  it("hands the button back once the wallet window may have been lost", () => {
    const waiting: WalletStatus = {
      state: "awaiting_wallet",
      intent: "unlock",
      canReprompt: false,
    };
    expect(walletCtaDisabled(waiting, true)).toBe(true);

    const stale: WalletStatus = { ...waiting, canReprompt: true };
    expect(walletCtaDisabled(stale, true)).toBe(false);
    expect(walletStatusCta(stale)!.label).toBe("Open Arch Wallet again");
  });

  it("sends a set-up-less extension to the extension, not to the store", () => {
    // `connect()` refuses outright when no wallet exists, so an unlock
    // button here can only fail — and "Install" is wrong too, since the
    // extension is right there.
    const cta = walletStatusCta({ state: "not_initialized" })!;
    expect(cta.message).toMatch(/creating or importing a wallet/i);
    expect(cta.action).not.toBe("install");
    expect(cta.action).not.toBe("unlock");
  });

  it("does not describe an empty extension as locked", () => {
    // The report this came from: the extension's account check answers
    // "Wallet locked" when there is no wallet in it at all, so the page
    // told the user to unlock something that did not exist.
    const cta = walletStatusCta({ state: "not_initialized" })!;
    expect(cta.title).not.toMatch(/locked/i);
    expect(cta.message).toMatch(/not locked/i);
    expect(cta.message).toMatch(/nothing to unlock/i);
  });

  it("re-tests an empty extension with connect, never with a re-read", () => {
    // A re-read asks `getAccount()`, which reports "Wallet locked"
    // whether or not a wallet exists — so `retry` as the primary action
    // would put the wrong state straight back on screen.
    const cta = walletStatusCta({ state: "not_initialized" })!;
    expect(cta.action).toBe("connect");
  });
});

describe("recovering from a blocked state", () => {
  it("goes locked → unlock → connected on the released extension", async () => {
    // `connect()` is the extension's prompt for a locked wallet: it opens
    // Approve, which renders Unlock first and resolves once the user is
    // through. Only after that does an account exist.
    let locked = true;
    installProvider({
      getAccount: async () => {
        if (locked) throw new Error("Wallet locked");
        return TURNKEY;
      },
      connect: async () => {
        locked = false;
        return TURNKEY;
      },
    });

    expect((await probeWalletStatus()).state).toBe("locked");
    __resetWalletGateway();
    expect(await startWalletConnect("unlock").result).toEqual({
      state: "connected",
      account: TURNKEY,
    });
    __resetWalletGateway();
    expect((await probeWalletStatus()).state).toBe("connected");
  });

  it("goes not_connected → connect → connected", async () => {
    let connected = false;
    installProvider({
      getAccount: async () => (connected ? TURNKEY : null),
      connect: async () => {
        connected = true;
        return TURNKEY;
      },
    });

    expect((await probeWalletStatus()).state).toBe("not_connected");
    __resetWalletGateway();
    expect((await startWalletConnect("connect").result).state).toBe("connected");
  });

  it("never turns an unfinished unlock into 'did not respond'", async () => {
    // Every one of these is how the released extension ends a prompt the
    // user did not complete. Routing them through the account-read
    // classifier produced `unavailable`, whose only offer was a re-read
    // that reported `locked` — the loop the user got stuck in.
    const endings = [
      "User rejected the request",
      "Request timed out",
      "Request expired",
      // The prompt answering with the state it was opened to change.
      "Wallet locked",
    ];
    for (const message of endings) {
      __resetWalletGateway();
      installProvider({
        connect: async () => {
          throw new Error(message);
        },
      });
      const status = await startWalletConnect("unlock").result;
      expect(status.state, message).toBe("prompt_unanswered");
      expect(walletStatusCta(status)?.action, message).toBe("unlock");
    }
  });

  it("separates a closed window from a request that aged out", async () => {
    const outcomes: Record<string, string> = {
      "User rejected the request": "dismissed",
      "Request timed out": "timeout",
      "Request expired": "timeout",
      "the extension exploded": "error",
    };
    for (const [message, reason] of Object.entries(outcomes)) {
      __resetWalletGateway();
      installProvider({
        connect: async () => {
          throw new Error(message);
        },
      });
      expect(await startWalletConnect("unlock").result).toMatchObject({
        state: "prompt_unanswered",
        reason,
      });
    }
  });

  it("keeps the states re-prompting cannot fix as themselves", async () => {
    __resetWalletGateway();
    installProvider({
      connect: async () => {
        throw new Error("Extension context invalidated.");
      },
    });
    expect((await startWalletConnect("unlock").result).state).toBe("stale_extension");

    __resetWalletGateway();
    installProvider({
      connect: async () => {
        throw new Error("Wallet not initialized");
      },
    });
    expect((await startWalletConnect("unlock").result).state).toBe("not_initialized");
  });
});

/**
 * The exact defect from the field report, which unit tests missed because
 * each call was tested on its own.
 *
 * The released extension gates its two entry points on different facts:
 * `GET_ACCOUNT` on whether a session is open, `CONNECT` on whether a
 * keystore exists. An extension with no wallet in it therefore answers
 * the read "Wallet locked" — a false statement — and the prompt "Wallet
 * not initialized". The page believed the read, offered Unlock, and every
 * poll re-confirmed the wrong state.
 */
describe("an extension with no wallet in it", () => {
  function emptyExtension() {
    installProvider({
      // Mirrors background.ts GET_ACCOUNT, which checks `isUnlocked()`
      // only — never whether a keystore exists.
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
      // Mirrors background.ts CONNECT, which checks `isSealed()`.
      connect: async () => {
        throw new Error("Wallet not initialized");
      },
    });
  }

  it("cannot tell locked from empty before connect has been tried", async () => {
    emptyExtension();
    // Honest: this really is indistinguishable from a locked wallet
    // until `connect()` has been asked.
    expect((await probeWalletStatus()).state).toBe("locked");
  });

  it("stops calling itself locked once connect has said otherwise", async () => {
    emptyExtension();
    expect((await probeWalletStatus()).state).toBe("locked");

    __resetWalletGateway();
    expect((await startWalletConnect("unlock").result).state).toBe("not_initialized");

    // The regression: this read used to come back `locked` and overwrite
    // the truthful state about two seconds after the user clicked.
    __resetWalletGateway();
    expect((await probeWalletStatus()).state).toBe("not_initialized");
  });

  it("keeps saying so across every later poll", async () => {
    emptyExtension();
    __resetWalletGateway();
    await startWalletConnect("unlock").result;

    for (let i = 0; i < 5; i += 1) {
      __resetWalletGateway();
      expect((await probeWalletStatus()).state).toBe("not_initialized");
    }
  });

  it("recovers with no reload once a wallet exists and is unlocked", async () => {
    emptyExtension();
    __resetWalletGateway();
    await startWalletConnect("unlock").result;
    __resetWalletGateway();
    expect((await probeWalletStatus()).state).toBe("not_initialized");

    // The user creates a wallet and unlocks it. The extension now serves
    // an account, and the latched verdict has to yield to it.
    installProvider({ getAccount: async () => TURNKEY });
    __resetWalletGateway();
    expect(await probeWalletStatus()).toEqual({ state: "connected", account: TURNKEY });
  });

  it("treats site-not-connected as proof a wallet exists", async () => {
    // The extension only reaches "Site not connected" after its unlock
    // check passes, which means a keystore was sealed and opened. A
    // `locked` reading after that is a real lock, not an empty extension.
    emptyExtension();
    __resetWalletGateway();
    await startWalletConnect("unlock").result;

    installProvider({
      getAccount: async () => {
        throw new Error("Site not connected");
      },
    });
    __resetWalletGateway();
    expect((await probeWalletStatus()).state).toBe("not_connected");

    installProvider({
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
    });
    __resetWalletGateway();
    expect((await probeWalletStatus()).state).toBe("locked");
  });

  it("leaves a genuinely locked wallet alone", async () => {
    // No `connect()` has contradicted the read, so nothing is rewritten.
    installProvider({
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
      connect: async () => TURNKEY,
    });
    expect((await probeWalletStatus()).state).toBe("locked");
    __resetWalletGateway();
    expect((await probeWalletStatus()).state).toBe("locked");
  });
});

describe("request serialization", () => {
  it("issues exactly one provider call per click", async () => {
    const connect = vi.fn(async () => TURNKEY);
    installProvider({ connect });

    await startWalletConnect("unlock").result;

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent status reads into one round trip", async () => {
    const getAccount = vi.fn(async () => TURNKEY);
    installProvider({ getAccount });

    await Promise.all([probeWalletStatus(), probeWalletStatus(), probeWalletStatus()]);

    expect(getAccount).toHaveBeenCalledTimes(1);
  });

  it("still issues a fresh read once the previous one has settled", async () => {
    const getAccount = vi.fn(async () => TURNKEY);
    installProvider({ getAccount });

    await probeWalletStatus();
    await probeWalletStatus();

    expect(getAccount).toHaveBeenCalledTimes(2);
  });

  it("never runs two reads at once", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    installProvider({
      getAccount: async () => {
        if (first) {
          first = false;
          order.push("read-a:start");
          await gate;
          order.push("read-a:end");
        } else {
          order.push("read-b");
        }
        return TURNKEY;
      },
    });

    const a = walletRequest("read-a", () => window.arch!.getAccount!());
    const b = walletRequest("read-b", () => window.arch!.getAccount!());
    release();
    await Promise.all([a, b]);

    expect(order).toEqual(["read-a:start", "read-a:end", "read-b"]);
  });

  it("lets a status read run while the user is answering a prompt", async () => {
    // A locked `connect()` stays pending for as long as the user takes
    // to type their password. Queuing reads behind it left the app blind
    // for that whole window and then replayed a stale one afterwards.
    let releaseConnect: () => void = () => {};
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    installProvider({
      connect: async () => {
        await connectGate;
        return TURNKEY;
      },
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
    });

    const prompt = startWalletConnect("unlock");
    expect(isWalletPromptInFlight()).toBe(true);

    // Resolves on its own, with the prompt still open.
    expect((await probeWalletStatus()).state).toBe("locked");
    expect(isWalletPromptInFlight()).toBe(true);

    releaseConnect();
    expect((await prompt.result).state).toBe("connected");
    expect(isWalletPromptInFlight()).toBe(false);
  });

  it("does not let a failed request strand the ones queued behind it", async () => {
    installProvider({
      connect: async () => {
        throw new Error("Wallet locked");
      },
      getAccount: async () => TURNKEY,
    });

    const first = startWalletConnect("unlock").result;
    const second = probeWalletStatus();

    expect((await first).state).toBe("prompt_unanswered");
    expect((await second).state).toBe("connected");
  });

  it("lets a re-prompt supersede the window it replaced", async () => {
    const connect = vi.fn(async () => TURNKEY);
    installProvider({ connect });

    const abandoned = startWalletConnect("unlock");
    const live = startWalletConnect("unlock");

    await Promise.all([abandoned.result, live.result]);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(isCurrentWalletPrompt(abandoned.id)).toBe(false);
    expect(isCurrentWalletPrompt(live.id)).toBe(true);
  });

  it("keeps two signatures in one flow distinct", async () => {
    // Un-keyed requests must never be coalesced: two approvals are two
    // approvals, even when they are issued back to back.
    const sign = vi.fn(async () => "sig");
    await Promise.all([
      walletRequest(null, sign),
      walletRequest(null, sign),
    ]);
    expect(sign).toHaveBeenCalledTimes(2);
  });
});

describe("requireConnectedArchAccount", () => {
  it("never prompts — it reports the state and lets the caller decide", async () => {
    const connect = vi.fn(async () => TURNKEY);
    installProvider({
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
      connect,
    });

    await expect(requireConnectedArchAccount()).rejects.toMatchObject({
      code: "WALLET_LOCKED",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("reports an unconnected origin without opening the approval popup", async () => {
    const connect = vi.fn(async () => TURNKEY);
    installProvider({ getAccount: async () => null, connect });

    await expect(requireConnectedArchAccount()).rejects.toMatchObject({
      code: "SITE_NOT_CONNECTED",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("returns the account when the extension can serve one", async () => {
    installProvider({ getAccount: async () => NO_KIND });
    await expect(requireConnectedArchAccount()).resolves.toMatchObject({
      archAddress: TURNKEY.archAddress,
    });
  });
});
