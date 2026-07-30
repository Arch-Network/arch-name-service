/**
 * The unlock loop, driven the way the user drove it.
 *
 * Reported as: "clicking unlock wallet just shows check wallet again and
 * then eventually goes back to unlock wallet". Both halves of that came
 * from this layer. A `connect()` that the user had not finished was
 * classified as a failed *read* — `unavailable`, "Check wallet again" —
 * and the focus probe that fires the moment the wallet window takes
 * focus then reported `locked` and returned the header to "Unlock Arch
 * Wallet". Nothing in between ever said a window was waiting.
 *
 * These cases assert the click contract end to end: one provider call
 * per click, a named waiting state for as long as the prompt is open,
 * no probe allowed to answer for it, and distinct honest states when it
 * ends without an answer.
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetWalletGateway } from "../lib/wallet-gateway";
import { __resetWalletInitialization } from "../lib/wallet-initialization";
import { walletStatusCta } from "../lib/wallet-status";
import { WALLET_POLL_ATTEMPTS } from "../lib/wallet-watch";
import { ArchWalletProvider, useArchWallet } from "./useArchWallet";
import { useWalletRecovery } from "./useWalletRecovery";

const ACCOUNT = {
  address: "tb1pa",
  publicKey: "02".padEnd(66, "a"),
  archAddress: "11".repeat(32),
};

type Provider = {
  getAccount: () => Promise<unknown>;
  connect: () => Promise<unknown>;
};

function installProvider(provider: Provider) {
  (window as unknown as { arch: Provider }).arch = provider;
}

/** jsdom's `visibilityState` is read-only; the watch reads it directly. */
function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function restoreVisibility() {
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
}

/**
 * Let the provider-detection interval retire. It reads once on its own,
 * 250ms after mount, which would otherwise be miscounted as a poll.
 */
async function settleDetection() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
}

/**
 * The header CTA, reduced to what the user can see and press. Reads the
 * same `walletStatusCta` the real header does.
 */
function Harness() {
  const { status } = useArchWallet();
  const recovery = useWalletRecovery();
  const cta = walletStatusCta(status);
  return (
    <button
      data-testid="cta"
      data-state={status.state}
      onClick={() => void recovery.run(cta!.action)}
    >
      {cta?.label ?? "connected"}
    </button>
  );
}

function renderHarness() {
  return render(
    <ArchWalletProvider>
      <Harness />
    </ArchWalletProvider>,
  );
}

const cta = () => screen.getByTestId("cta") as HTMLButtonElement;
const state = () => cta().getAttribute("data-state");
const label = () => cta().textContent;

/** Wait for the mount probe to land so clicks start from a known state. */
async function settleAtLocked() {
  await waitFor(() => expect(state()).toBe("locked"));
}

beforeEach(() => {
  __resetWalletGateway();
  __resetWalletInitialization();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  restoreVisibility();
  delete (window as unknown as { arch?: unknown }).arch;
});

describe("clicking Unlock", () => {
  it("issues exactly one provider call and says a window is waiting", async () => {
    // The released extension neither resolves nor rejects a locked
    // `connect()`: it holds the request open and renders Unlock inside
    // its own window. Nothing about that is a failure.
    const connect = vi.fn(() => new Promise<never>(() => {}));
    installProvider({
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
      connect,
    });

    renderHarness();
    await settleAtLocked();

    await act(async () => {
      cta().click();
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(state()).toBe("awaiting_wallet");
    expect(label()).toBe("Waiting for Arch Wallet…");
  });

  it("is never reported as unavailable while the prompt is open", async () => {
    installProvider({
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
      connect: () => new Promise<never>(() => {}),
    });

    renderHarness();
    await settleAtLocked();
    await act(async () => {
      cta().click();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(state()).not.toBe("unavailable");
    expect(state()).toBe("awaiting_wallet");
  });

  it("offers to re-open a window the user cannot find", async () => {
    const connect = vi.fn(() => new Promise<never>(() => {}));
    installProvider({
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
      connect,
    });

    renderHarness();
    await settleAtLocked();
    await act(async () => {
      cta().click();
    });
    expect(label()).toBe("Waiting for Arch Wallet…");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // The wallet window opens behind the browser often enough that a
    // permanently disabled button is a dead end.
    expect(label()).toBe("Open Arch Wallet again");

    await act(async () => {
      cta().click();
    });
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("reaches connected on its own once the user finishes", async () => {
    let unlock: (account: unknown) => void = () => {};
    let locked = true;
    installProvider({
      getAccount: async () => {
        if (locked) throw new Error("Wallet locked");
        return ACCOUNT;
      },
      connect: () =>
        new Promise((resolve) => {
          unlock = resolve;
        }),
    });

    renderHarness();
    await settleAtLocked();
    await act(async () => {
      cta().click();
    });
    expect(state()).toBe("awaiting_wallet");

    await act(async () => {
      locked = false;
      unlock(ACCOUNT);
    });

    // No second click anywhere in this test.
    await waitFor(() => expect(state()).toBe("connected"));
  });
});

/**
 * The field report, end to end, through the real watch loop.
 *
 * An extension with no wallet in it answers `getAccount()` with "Wallet
 * locked" and `connect()` with "Wallet not initialized". The page showed
 * "Unlock Arch Wallet", the click produced the truthful state, and the
 * next poll — about two and a half seconds later — put "Unlock Arch
 * Wallet" back. There was no way out of that, including reloading.
 */
describe("an extension with no wallet in it", () => {
  function installEmptyExtension() {
    installProvider({
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
      connect: async () => {
        throw new Error("Wallet not initialized");
      },
    });
  }

  it("does not go back to Unlock after the poll runs again", async () => {
    installEmptyExtension();
    renderHarness();
    await settleAtLocked();

    await act(async () => {
      cta().click();
    });
    await waitFor(() => expect(state()).toBe("not_initialized"));

    // Long enough for several polls at the 2.5s → 15s backoff. This is
    // the assertion that used to fail after ~2.5 seconds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(state()).toBe("not_initialized");
    expect(label()).not.toBe("Unlock Arch Wallet");
  });

  it("never offers to unlock something with nothing in it", async () => {
    installEmptyExtension();
    renderHarness();
    await settleAtLocked();
    await act(async () => {
      cta().click();
    });
    await waitFor(() => expect(state()).toBe("not_initialized"));

    const notice = walletStatusCta({ state: "not_initialized" })!;
    expect(notice.title).not.toMatch(/locked/i);
    expect(label()).toBe("Connect wallet");
  });

  it("picks the wallet up once the user finishes setting it up", async () => {
    // The user creates a wallet in the extension and unlocks it. No
    // reload, no click — the watch loop's next read has to resolve it.
    let ready = false;
    installProvider({
      getAccount: async () => {
        if (!ready) throw new Error("Wallet locked");
        return ACCOUNT;
      },
      connect: async () => {
        if (!ready) throw new Error("Wallet not initialized");
        return ACCOUNT;
      },
    });

    renderHarness();
    await settleAtLocked();
    await act(async () => {
      cta().click();
    });
    await waitFor(() => expect(state()).toBe("not_initialized"));

    ready = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    await waitFor(() => expect(state()).toBe("connected"));
  });

  it("keeps polling with reads only, never a second prompt", async () => {
    const connect = vi.fn(async () => {
      throw new Error("Wallet not initialized");
    });
    installProvider({
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
      connect,
    });

    renderHarness();
    await settleAtLocked();
    await act(async () => {
      cta().click();
    });
    await waitFor(() => expect(state()).toBe("not_initialized"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // One click, one prompt. Polling must never open a wallet window.
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe("a prompt that ends without an answer", () => {
  /** @returns the state the header settles on. */
  async function endPromptWith(message: string) {
    cleanup();
    __resetWalletGateway();
    let fail: (error: Error) => void = () => {};
    installProvider({
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
      connect: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    });

    renderHarness();
    await settleAtLocked();
    await act(async () => {
      cta().click();
    });
    await act(async () => {
      fail(new Error(message));
    });
    await waitFor(() => expect(state()).not.toBe("awaiting_wallet"));
    return { state: state(), label: label() };
  }

  it("says the window closed, and offers the same prompt again", async () => {
    const result = await endPromptWith("User rejected the request");
    expect(result.state).toBe("prompt_unanswered");
    // The old behaviour: "Check wallet again", which re-read a locked
    // wallet and put "Unlock Arch Wallet" back — the loop.
    expect(result.label).toBe("Unlock Arch Wallet");
  });

  it("distinguishes a timeout from a closed window", async () => {
    const dismissed = await endPromptWith("User rejected the request");
    const timedOut = await endPromptWith("Request timed out");

    expect(dismissed.state).toBe("prompt_unanswered");
    expect(timedOut.state).toBe("prompt_unanswered");
    expect(walletStatusCta({ state: "prompt_unanswered", intent: "unlock", reason: "dismissed" })!
      .title).not.toBe(
      walletStatusCta({ state: "prompt_unanswered", intent: "unlock", reason: "timeout" })!.title,
    );
  });

  it("sends a missing wallet to the extension rather than round in circles", async () => {
    const result = await endPromptWith("Wallet not initialized");
    expect(result.state).toBe("not_initialized");
    expect(result.label).toBe("Connect wallet");
  });
});

describe("no extension at all", () => {
  it("offers the store, and does not strand the click", async () => {
    // Uninstalled mid-session is the case that used to hang: the click
    // had no provider to reach, and the "waiting" state it had already
    // published had nothing left to clear it.
    installProvider({
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
      connect: async () => ACCOUNT,
    });
    renderHarness();
    await settleAtLocked();

    delete (window as unknown as { arch?: unknown }).arch;
    await act(async () => {
      cta().click();
    });

    await waitFor(() => expect(state()).toBe("no_extension"));
    expect(label()).toBe("Connect wallet");
  });
});

describe("competing probes", () => {
  it("does not let the focus re-probe answer for an open prompt", async () => {
    // Opening the wallet window blurs this one, so coming back fires
    // `focus`. That probe reports `locked` — truthfully, the user is
    // still typing — and used to overwrite the waiting state with the
    // very button they had just pressed.
    //
    // The read itself is welcome now, and deliberately so: refusing to
    // look while a prompt was open is what left the page unable to
    // notice a wallet the user had unlocked elsewhere. What must not
    // happen is publishing that reading over the waiting state.
    const getAccount = vi.fn(async () => {
      throw new Error("Wallet locked");
    });
    installProvider({ getAccount, connect: () => new Promise<never>(() => {}) });

    renderHarness();
    await settleAtLocked();
    await act(async () => {
      cta().click();
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(getAccount.mock.calls.length).toBeGreaterThan(1);
    expect(state()).toBe("awaiting_wallet");
    expect(label()).toBe("Open Arch Wallet again");
  });

  it("keeps 'the window closed' from decaying back into 'locked'", async () => {
    // A poll that reports `locked` after a dismissed prompt is not news,
    // and letting it write would replace the one sentence explaining
    // what just happened with the state the user already knew about.
    let fail: (error: Error) => void = () => {};
    installProvider({
      getAccount: async () => {
        throw new Error("Wallet locked");
      },
      connect: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    });

    renderHarness();
    await settleAtLocked();
    await act(async () => {
      cta().click();
    });
    await act(async () => {
      fail(new Error("User rejected the request"));
    });
    await waitFor(() => expect(state()).toBe("prompt_unanswered"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(state()).toBe("prompt_unanswered");
  });
});

/**
 * The report this file's second round exists for: "wallet is unlocked",
 * beside a page still offering "Unlock Arch Wallet".
 *
 * Unlocking from the Chrome toolbar icon is not an event this page can
 * see. The tab stays visible, never loses or regains focus, and fires
 * nothing at all — so an app that only re-reads on mount and on focus
 * has no moment at which it would ever look again, and the `locked`
 * reading from page load stays on screen for as long as the tab is open.
 */
describe("a wallet unlocked somewhere else", () => {
  it("reaches connected on its own, with no click and no event", async () => {
    let locked = true;
    const connect = vi.fn(async () => ACCOUNT);
    installProvider({
      getAccount: async () => {
        if (locked) throw new Error("Wallet locked");
        return ACCOUNT;
      },
      connect,
    });

    renderHarness();
    await settleAtLocked();
    await settleDetection();

    // The user unlocks in the extension panel. Nothing happens here.
    locked = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(state()).toBe("connected");
    // Polling reads. It must never open a wallet window on its own.
    expect(connect).not.toHaveBeenCalled();
  });

  it("offers Connect, not Unlock, when the origin is the missing half", async () => {
    let locked = true;
    installProvider({
      getAccount: async () => {
        if (locked) throw new Error("Wallet locked");
        throw new Error("Site not connected");
      },
      connect: async () => ACCOUNT,
    });

    renderHarness();
    await settleAtLocked();
    await settleDetection();

    locked = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(state()).toBe("not_connected");
    expect(label()).toBe("Connect wallet");
  });

  it("recovers on a click on the page, which is all some tabs ever get", async () => {
    let locked = true;
    installProvider({
      getAccount: async () => {
        if (locked) throw new Error("Wallet locked");
        return ACCOUNT;
      },
      connect: async () => ACCOUNT,
    });

    renderHarness();
    await settleAtLocked();

    locked = false;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(state()).toBe("connected"));
  });

  it("stops reading while the tab is hidden, and resumes when it returns", async () => {
    const getAccount = vi.fn(async () => {
      throw new Error("Wallet locked");
    });
    installProvider({ getAccount, connect: async () => ACCOUNT });

    renderHarness();
    await settleAtLocked();
    await settleDetection();

    await act(async () => {
      setVisibility("hidden");
    });
    const readsWhenHidden = getAccount.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getAccount).toHaveBeenCalledTimes(readsWhenHidden);

    await act(async () => {
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(getAccount.mock.calls.length).toBeGreaterThan(readsWhenHidden);
  });

  it("stops reading once the wallet is connected", async () => {
    const getAccount = vi.fn(async () => ACCOUNT);
    installProvider({ getAccount, connect: async () => ACCOUNT });

    renderHarness();
    await waitFor(() => expect(state()).toBe("connected"));
    await settleDetection();

    const readsWhenConnected = getAccount.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(getAccount).toHaveBeenCalledTimes(readsWhenConnected);
  });

  it("stands down after a bounded run, and starts again on a click", async () => {
    // A tab left open on a locked wallet must not read forever. Backing
    // off and then stopping is what keeps that from being a background
    // heartbeat nobody asked for; any sign of the user brings it back.
    const getAccount = vi.fn(async () => {
      throw new Error("Wallet locked");
    });
    installProvider({ getAccount, connect: async () => ACCOUNT });

    renderHarness();
    await settleAtLocked();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60_000);
    });

    const readsWhenIdle = getAccount.mock.calls.length;
    expect(readsWhenIdle).toBeLessThanOrEqual(WALLET_POLL_ATTEMPTS + 2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getAccount).toHaveBeenCalledTimes(readsWhenIdle);

    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(getAccount.mock.calls.length).toBeGreaterThan(readsWhenIdle);
  });
});
