/**
 * The rules that let the page notice a wallet it did not change.
 *
 * The report behind these cases: an unlocked wallet on one side of the
 * screen, "Arch Wallet is locked" on the other, and nothing that would
 * ever reconcile them. Two mechanisms had to hold for that to be
 * impossible — a schedule that keeps looking, and a guard that can only
 * ever suppress a reading for as long as a prompt could really be open.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetWalletGateway,
  isWalletPromptInFlight,
  PROMPT_GUARD_MAX_MS,
  walletPrompt,
} from "./wallet-gateway";
import type { WalletStatus } from "./wallet-status";
import {
  isBlockedWalletStatus,
  nextPollDelay,
  sameWalletStatus,
  shouldAdoptProbe,
  WALLET_POLL_MAX_MS,
  WALLET_POLL_MIN_MS,
} from "./wallet-watch";

const ACCOUNT = {
  address: "tb1pa",
  publicKey: "02".padEnd(66, "a"),
  archAddress: "11".repeat(32),
};

const CONNECTED: WalletStatus = { state: "connected", account: ACCOUNT };
const LOCKED: WalletStatus = { state: "locked" };
const WAITING: WalletStatus = {
  state: "awaiting_wallet",
  intent: "unlock",
  canReprompt: false,
};
const UNANSWERED: WalletStatus = {
  state: "prompt_unanswered",
  intent: "unlock",
  reason: "dismissed",
};

beforeEach(() => {
  __resetWalletGateway();
});

describe("isBlockedWalletStatus", () => {
  it("watches every state that something outside the page can clear", () => {
    const watched: WalletStatus[] = [
      LOCKED,
      { state: "not_connected" },
      { state: "not_initialized" },
      WAITING,
      UNANSWERED,
      { state: "unavailable", detail: "kaboom" },
      { state: "unsupported_account", account: ACCOUNT },
    ];
    for (const status of watched) {
      expect(isBlockedWalletStatus(status), status.state).toBe(true);
    }
  });

  it("leaves the states a read cannot help alone", () => {
    // `connected` needs nothing. `detecting` and `no_extension` have no
    // provider to read and belong to the detection loop. Every read
    // against a dead extension context fails identically; only a reload
    // clears it.
    const ignored: WalletStatus[] = [
      CONNECTED,
      { state: "detecting" },
      { state: "no_extension" },
      { state: "stale_extension" },
    ];
    for (const status of ignored) {
      expect(isBlockedWalletStatus(status), status.state).toBe(false);
    }
  });
});

describe("nextPollDelay", () => {
  it("starts fast, backs off, and settles at a ceiling", () => {
    expect(nextPollDelay(0)).toBe(WALLET_POLL_MIN_MS);
    expect(nextPollDelay(1)).toBeGreaterThan(WALLET_POLL_MIN_MS);
    expect(nextPollDelay(3)).toBeGreaterThan(nextPollDelay(2));
    expect(nextPollDelay(50)).toBe(WALLET_POLL_MAX_MS);
  });

  it("reads within a few seconds of the state appearing", () => {
    // The whole point is that the user unlocks and the page catches up
    // before they wonder whether it is broken.
    expect(nextPollDelay(0)).toBeLessThanOrEqual(3_000);
  });
});

describe("shouldAdoptProbe", () => {
  it("always publishes a reading that names an account", () => {
    // This is the out-of-band unlock landing. It has to win from every
    // state, including the ones that otherwise protect a prompt.
    for (const current of [LOCKED, WAITING, UNANSWERED, { state: "not_connected" } as const]) {
      expect(shouldAdoptProbe(current, CONNECTED), current.state).toBe(true);
    }
  });

  it("does not overwrite a prompt the user is part of with what it already said", () => {
    expect(shouldAdoptProbe(WAITING, LOCKED)).toBe(false);
    expect(shouldAdoptProbe(WAITING, { state: "not_connected" })).toBe(false);
    expect(shouldAdoptProbe(UNANSWERED, LOCKED)).toBe(false);
    expect(shouldAdoptProbe(UNANSWERED, { state: "unavailable", detail: "x" })).toBe(false);
  });

  it("lets a condition re-prompting cannot fix through a prompt state", () => {
    for (const probed of [
      { state: "no_extension" } as const,
      { state: "not_initialized" } as const,
      { state: "stale_extension" } as const,
    ]) {
      expect(shouldAdoptProbe(WAITING, probed), probed.state).toBe(true);
    }
  });

  it("publishes freely when no prompt is being narrated", () => {
    expect(shouldAdoptProbe(LOCKED, { state: "not_connected" })).toBe(true);
    expect(shouldAdoptProbe({ state: "not_connected" }, LOCKED)).toBe(true);
  });
});

describe("sameWalletStatus", () => {
  it("treats two readings of one state as the same reading", () => {
    // Every poll builds a fresh object. Publishing those re-renders the
    // app and restarts anything keyed on the status — which turns a
    // backoff schedule back into a fixed interval.
    expect(sameWalletStatus({ state: "locked" }, { state: "locked" })).toBe(true);
    expect(sameWalletStatus(CONNECTED, { state: "connected", account: { ...ACCOUNT } })).toBe(true);
  });

  it("tells apart the changes that matter", () => {
    expect(sameWalletStatus(LOCKED, { state: "not_connected" })).toBe(false);
    expect(
      sameWalletStatus(CONNECTED, {
        state: "connected",
        account: { ...ACCOUNT, archAddress: "22".repeat(32) },
      }),
    ).toBe(false);
    expect(sameWalletStatus(WAITING, { ...WAITING, canReprompt: true })).toBe(false);
    expect(sameWalletStatus(UNANSWERED, { ...UNANSWERED, reason: "timeout" })).toBe(false);
    expect(
      sameWalletStatus({ state: "unavailable", detail: "a" }, { state: "unavailable", detail: "b" }),
    ).toBe(false);
  });
});

describe("the prompt guard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears when the prompt resolves", async () => {
    const prompt = walletPrompt(async () => "ok");
    expect(isWalletPromptInFlight()).toBe(true);
    await prompt.result;
    expect(isWalletPromptInFlight()).toBe(false);
  });

  it("clears when the prompt rejects", async () => {
    const prompt = walletPrompt(async () => {
      throw new Error("User rejected the request");
    });
    expect(isWalletPromptInFlight()).toBe(true);
    await expect(prompt.result).rejects.toThrow();
    expect(isWalletPromptInFlight()).toBe(false);
  });

  it("clears when the provider throws before returning a promise", async () => {
    const prompt = walletPrompt(() => {
      throw new Error("no provider");
    });
    expect(isWalletPromptInFlight()).toBe(false);
    await expect(prompt.result).rejects.toThrow();
  });

  it("clears when the provider answers with something that is not a promise", () => {
    // A bare counter decremented from `result.then` would have thrown
    // here and left the guard set for the life of the page.
    expect(() => walletPrompt(() => "sync" as unknown as Promise<string>)).not.toThrow();
    expect(isWalletPromptInFlight()).toBe(true);
    return Promise.resolve().then(() => {
      expect(isWalletPromptInFlight()).toBe(false);
    });
  });

  it("cannot outlive the provider's own deadline, even if nothing settles", () => {
    // The latch: a `connect()` that never resolves and never rejects.
    // While the guard was believed to be open, no read could publish a
    // state — so a wallet the user had already unlocked stayed `locked`
    // until the tab was closed.
    vi.useFakeTimers();
    walletPrompt(() => new Promise<never>(() => {}));
    expect(isWalletPromptInFlight()).toBe(true);

    vi.advanceTimersByTime(PROMPT_GUARD_MAX_MS - 1);
    expect(isWalletPromptInFlight()).toBe(true);

    vi.advanceTimersByTime(2);
    expect(isWalletPromptInFlight()).toBe(false);
  });
});
