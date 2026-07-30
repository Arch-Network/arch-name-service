/**
 * The single source of truth for "what can the wallet do for us right now".
 *
 * Companion to `wallet-state.ts`, which turns a *failed action* into
 * recovery copy. This module answers the question that comes first: what
 * state is the extension in, before we ask it for anything. The
 * distinction matters because the app used to keep a React snapshot of
 * the last account it saw and treat that as "connected" forever — so a
 * wallet that auto-locked still rendered an address chip, and the first
 * click after that opened an unlock popup the header said was
 * unnecessary.
 *
 * The rule this module exists to enforce: an address is only ever shown
 * when the extension reported that address on the most recent read. Every
 * other state is a named state with one obvious next step, never a
 * remembered address.
 */

import { classifyWalletBlocker, type WalletRecoveryAction } from "./wallet-state";
import {
  hasArchProvider,
  walletPrompt,
  walletRequest,
  type WalletPromptHandle,
} from "./wallet-gateway";
import { rememberSeenAccount } from "./signer-registry";
import {
  clearNotInitialized,
  isKnownNotInitialized,
  rememberNotInitialized,
} from "./wallet-initialization";

export type ConnectedAccount = {
  address: string;
  publicKey: string;
  archAddress: string;
  /**
   * `turnkey | external | watch` on extensions that report it. Released
   * builds may omit it entirely, so absence means "unknown", never
   * "unsupported".
   */
  kind?: string;
  /** Kit / ANS provider id when known (`arch-extension`, `xverse`, …). */
  providerId?: string;
  /** Short label for the header chip (`Arch Wallet`, `Xverse`, …). */
  providerLabel?: string;
};

/** What an interactive request is asking the wallet for. */
export type WalletPromptIntent = "unlock" | "connect";

/**
 * How an interactive request ended without an answer.
 *
 * None of these is a wallet *state*. The wallet is exactly as locked as
 * it was before; what failed is the conversation, and the fix is to
 * start it again — which is why they are kept apart from `unavailable`.
 */
export type WalletPromptFailure =
  /** The approval window closed before the user finished with it. */
  | "dismissed"
  /** The request aged out. The window may still be open somewhere. */
  | "timeout"
  /** The extension answered with something we cannot act on. */
  | "error";

export type WalletStatus =
  /** Provider not injected yet; the extension may still be booting. */
  | { state: "detecting" }
  | { state: "no_extension" }
  /**
   * Extension installed, but it holds no keystore — no wallet has ever
   * been created or imported in it. Distinct from `locked`, which has a
   * keystore the user can open; there is nothing here to unlock.
   */
  | { state: "not_initialized" }
  /** Extension present but locked: it cannot name an account. */
  | { state: "locked" }
  /** Unlocked, but this origin has no approved connection. */
  | { state: "not_connected" }
  /**
   * A wallet window is open and the request is still pending. Neither a
   * success nor a failure: the extension holds `connect()` open on
   * purpose until the user answers it.
   */
  | { state: "awaiting_wallet"; intent: WalletPromptIntent; canReprompt: boolean }
  /** The prompt ended with no answer. Asking again is the way out. */
  | {
      state: "prompt_unanswered";
      intent: WalletPromptIntent;
      reason: WalletPromptFailure;
      detail?: string;
    }
  /** The injected provider is talking to a dead extension context. */
  | { state: "stale_extension" }
  /** Present and reachable, but failing for a reason we cannot classify. */
  | { state: "unavailable"; detail: string }
  /** An account we can name, but one the extension cannot sign ANS with. */
  | { state: "unsupported_account"; account: ConnectedAccount }
  | { state: "connected"; account: ConnectedAccount };

/** What the UI should offer for a status. `install` and `retry` are ours. */
export type WalletStatusAction = WalletRecoveryAction | "install" | "retry" | "choose_wallet";

/**
 * `getAccount()` rejects rather than returning null when the wallet is
 * locked, so the message is the only signal. Raising a typed error keeps
 * every caller — and `classifyWalletBlocker` — on one spelling.
 */
export class WalletLockedError extends Error {
  readonly code = "WALLET_LOCKED" as const;

  constructor() {
    super("Arch Wallet is locked. Unlock it, then try again.");
    this.name = "WalletLockedError";
  }
}

export class SiteNotConnectedError extends Error {
  readonly code = "SITE_NOT_CONNECTED" as const;

  constructor() {
    super("Site not connected to Arch Wallet. Connect it, then try again.");
    this.name = "SiteNotConnectedError";
  }
}

/**
 * Account kinds that cannot produce an Arch message-hash signature.
 *
 * Unknown (`undefined`) is treated as signable on purpose: the released
 * extension does not report `kind`, and blocking on a field it never
 * sends would make registration impossible for everyone. If such an
 * account really cannot sign, the wallet says so at signing time and the
 * failure copy takes over.
 */
export function isSignableAccount(account: { kind?: string }): boolean {
  return account.kind !== "external" && account.kind !== "watch";
}

export function normalizeAccount(
  next: {
    address?: string;
    publicKey?: string;
    archAddress?: string;
    kind?: string;
    providerId?: string;
    providerLabel?: string;
  } | null
    | undefined,
): ConnectedAccount | null {
  if (!next?.archAddress) return null;
  return {
    address: next.address ?? "",
    publicKey: next.publicKey ?? "",
    archAddress: next.archAddress,
    kind: next.kind,
    providerId: next.providerId,
    providerLabel: next.providerLabel,
  };
}

function accountStatus(account: ConnectedAccount): WalletStatus {
  // Every account the wallet names becomes a candidate key for signature
  // identification later. This is the app's only way to build that list:
  // there is no provider call that enumerates wallet accounts.
  rememberSeenAccount(account.archAddress);
  return isSignableAccount(account)
    ? { state: "connected", account }
    : { state: "unsupported_account", account };
}

/**
 * A wallet the user has never set up. `connect()` refuses outright — no
 * window opens — so offering "Unlock" here is a button that can only
 * fail.
 *
 * This is the only place the condition is observable: the read path
 * reports it as "Wallet locked", because the extension's account check
 * asks whether a session is open and never whether a keystore exists.
 */
const NOT_INITIALIZED_PATTERN = /wallet not initialized|no wallet (has been )?created/i;

/**
 * The three ways the released extension ends a prompt without answering.
 *
 * `classifyWalletBlocker` matches none of them, so they used to land in
 * `statusFromError`'s default branch as `unavailable` — "Arch Wallet did
 * not respond", whose only offer is a re-read. The re-read reported
 * `locked`, the header went back to "Unlock Arch Wallet", and the user
 * was where they started. That round trip is the loop.
 *
 *   "User rejected the request"  the approval window closed, which the
 *                                background reports for any close, not
 *                                just a deliberate Reject
 *   "Request timed out"          the injected provider's 120s deadline
 *   "Request expired"            the background's 5-minute pending sweep
 */
const PROMPT_DISMISSED_PATTERN = /user (rejected|denied|declined)|request rejected/i;
const PROMPT_TIMEOUT_PATTERN = /request timed out|request expired/i;

export function classifyWalletPromptFailure(error: unknown): WalletPromptFailure | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (PROMPT_DISMISSED_PATTERN.test(message)) return "dismissed";
  if (PROMPT_TIMEOUT_PATTERN.test(message)) return "timeout";
  return null;
}

/** Map any wallet failure onto the state it implies. */
export function statusFromError(error: unknown): WalletStatus {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const blocker = classifyWalletBlocker(error);
  if (!blocker && NOT_INITIALIZED_PATTERN.test(raw)) return { state: "not_initialized" };
  switch (blocker) {
    case "locked":
      return { state: "locked" };
    case "not_connected":
    // The connected account vanished (site revoked, account deleted).
    // From a read's point of view this origin simply has no connection.
    case "needs_reconnect":
      return { state: "not_connected" };
    case "stale_extension":
      return { state: "stale_extension" };
    default:
      return { state: "unavailable", detail: raw || "Unknown wallet error" };
  }
}

/** The typed error a non-account status represents, for throwing callers. */
export function walletStatusError(status: WalletStatus): Error {
  switch (status.state) {
    case "locked":
      return new WalletLockedError();
    case "not_connected":
      return new SiteNotConnectedError();
    case "stale_extension":
      return new Error("Extension context invalidated. Reload this page and try again.");
    case "no_extension":
    case "detecting":
      return new Error(
        "Arch Wallet is not available. Install/enable the Chrome extension, then reload.",
      );
    case "not_initialized":
      return new Error(
        "Arch Wallet has no wallet in it yet. Open the extension and create or import one.",
      );
    case "awaiting_wallet":
      return new Error("Arch Wallet is still waiting for you in its own window.");
    case "prompt_unanswered":
      return new Error(promptUnansweredCta(status).message);
    case "unavailable":
      return new Error(status.detail);
    case "unsupported_account":
      return new Error(
        "This Arch Wallet account cannot sign ANS updates. Switch to an account the extension holds keys for.",
      );
    case "connected":
      return new Error("Arch Wallet is connected.");
  }
}

/** The account behind a status, or null. Never a remembered address. */
export function statusAccount(status: WalletStatus): ConnectedAccount | null {
  if (status.state === "connected" || status.state === "unsupported_account") {
    return status.account;
  }
  return null;
}

/** True only when a mutation may be attempted without prompting first. */
export function canSubmit(status: WalletStatus): boolean {
  return status.state === "connected";
}

/**
 * Record what an observation proves about the extension's keystore.
 *
 * See `wallet-initialization.ts`: the read path cannot distinguish a
 * locked wallet from an empty extension, so what the other states imply
 * has to be carried across reads.
 */
function noteInitializationEvidence(status: WalletStatus): void {
  switch (status.state) {
    case "not_initialized":
      rememberNotInitialized();
      break;
    // An account proves a keystore exists. So does `not_connected`: the
    // extension only reaches that answer after its unlock check passes.
    case "connected":
    case "unsupported_account":
    case "not_connected":
      clearNotInitialized();
      break;
    default:
      break;
  }
}

/**
 * Report a `locked` reading as what it is when we know better.
 *
 * "Wallet locked" is the extension's answer both for a sealed wallet
 * waiting on a password and for an extension with no wallet in it at
 * all. Only `connect()` separates them, so once it has, its answer wins
 * over the reading it already contradicted.
 */
function resolveAmbiguousLock(status: WalletStatus): WalletStatus {
  if (status.state !== "locked") return status;
  return isKnownNotInitialized() ? { state: "not_initialized" } : status;
}

/**
 * Ask the extension what it can do for this origin, without prompting.
 *
 * `getAccount()` is popup-free by design: locked and unconnected both
 * come back as rejections, which is exactly the information the UI needs
 * to show an honest state instead of guessing.
 */
export async function probeWalletStatus(): Promise<WalletStatus> {
  if (!hasArchProvider()) return { state: "no_extension" };
  const provider = window.arch!;
  if (!provider.getAccount) {
    // No read API to interrogate; the only way forward is to ask.
    return { state: "not_connected" };
  }
  try {
    const account = normalizeAccount(
      await walletRequest("get-account", () => provider.getAccount!()),
    );
    const status: WalletStatus = account ? accountStatus(account) : { state: "not_connected" };
    noteInitializationEvidence(status);
    return status;
  } catch (error) {
    const status = statusFromError(error);
    noteInitializationEvidence(status);
    return resolveAmbiguousLock(status);
  }
}

/**
 * Turn a prompt rejection into a state, without pretending it was a read.
 *
 * The distinction the old code missed: a `connect()` that comes back
 * "Wallet locked" has told us nothing new. It is not a fresh reading of
 * a locked wallet — it is the unlock prompt itself reporting that the
 * user never got through it. Answering that with "Unlock Arch Wallet"
 * is the loop. `prompt_unanswered` says what actually happened and
 * offers the same prompt again, which is the only thing that helps.
 */
function promptFailureStatus(error: unknown, intent: WalletPromptIntent): WalletStatus {
  const reason = classifyWalletPromptFailure(error);
  if (reason) return { state: "prompt_unanswered", intent, reason };

  const status = statusFromError(error);
  switch (status.state) {
    case "locked":
    case "not_connected":
      return { state: "prompt_unanswered", intent, reason: "dismissed" };
    case "unavailable":
      return { state: "prompt_unanswered", intent, reason: "error", detail: status.detail };
    default:
      // `no_extension`, `not_initialized` and `stale_extension` are real
      // conditions with their own next step. Re-prompting cannot fix
      // any of them, so they are reported as themselves.
      return status;
  }
}

/**
 * The extension's one interactive entry point, issued right now.
 *
 * `connect()` covers both recoverable states on the released build: the
 * background keeps the request pending and opens Approve, which renders
 * Unlock first when the wallet is locked and the connection card after.
 * That is why "Unlock Arch Wallet" and "Connect wallet" run the same
 * call — they differ only in what the user is told to expect.
 *
 * Deliberately not `async`. The provider call has to be made in the same
 * synchronous turn as the click, which means this function cannot await
 * anything before reaching it; callers get the handle back immediately
 * and can render "waiting" before the answer arrives. See `walletPrompt`
 * for why queuing this call was the other half of the unlock loop.
 */
export function startWalletConnect(intent: WalletPromptIntent): WalletPromptHandle<WalletStatus> {
  // A missing provider still takes a prompt id. The caller decides
  // whether its answer is the current one by comparing ids, and handing
  // back an id that can never be current would strand the click.
  if (!hasArchProvider()) {
    return walletPrompt<WalletStatus>(async () => ({ state: "no_extension" }));
  }
  const provider = window.arch!;
  const prompt = walletPrompt(() => provider.connect());
  return {
    id: prompt.id,
    result: prompt.result.then(
      (raw): WalletStatus => {
        const account = normalizeAccount(raw);
        const status: WalletStatus = account ? accountStatus(account) : { state: "not_connected" };
        noteInitializationEvidence(status);
        return status;
      },
      (error): WalletStatus => {
        const status = promptFailureStatus(error, intent);
        // This is the only call that can see "Wallet not initialized",
        // so this is the only chance to record it.
        noteInitializationEvidence(status);
        return status;
      },
    ),
  };
}

export type WalletStatusCta = {
  action: WalletStatusAction;
  /** Button text. */
  label: string;
  /** Notice heading when a view has to explain why it cannot proceed. */
  title: string;
  message: string;
  /** Offered alongside the primary action when there is a second way out. */
  secondaryAction?: WalletStatusAction;
  secondaryLabel?: string;
};

/**
 * The wallet window opens as a small separate Chrome window and is
 * routinely lost behind the browser, which reads to the user as "I
 * clicked and nothing happened". Every prompt-related message says so.
 */
const FIND_THE_WINDOW =
  "Arch Wallet opens as a separate small window, which can end up behind this " +
  "one — check your other windows if you do not see it.";

/** Copy for a prompt that closed without an answer. */
function promptUnansweredCta(status: {
  intent: WalletPromptIntent;
  reason: WalletPromptFailure;
  detail?: string;
}): WalletStatusCta {
  const label = status.intent === "unlock" ? "Unlock Arch Wallet" : "Connect wallet";
  const outcome = status.intent === "unlock" ? "unlocked" : "connected";
  switch (status.reason) {
    case "dismissed":
      return {
        action: status.intent,
        label,
        title: "The Arch Wallet window closed",
        message:
          `Arch Wallet closed before it was ${outcome}, so nothing changed and ` +
          `nothing was sent to the network. ${FIND_THE_WINDOW}`,
      };
    case "timeout":
      return {
        action: status.intent,
        label,
        title: "Arch Wallet did not answer in time",
        message:
          `The request to Arch Wallet expired before it was ${outcome}. Nothing was ` +
          `sent to the network. ${FIND_THE_WINDOW} Try again — a fresh request opens ` +
          `a fresh window.`,
      };
    case "error":
      return {
        action: status.intent,
        label,
        title: "Arch Wallet could not complete the request",
        message:
          `Arch Wallet returned an error instead of ${
            status.intent === "unlock" ? "unlocking" : "connecting"
          }. Nothing was sent to the network. Try again, or reload the page if it ` +
          `keeps failing.`,
      };
  }
}

/**
 * The single next step for a status, or null when nothing is blocking.
 *
 * Every CTA in the app derives from this so the header, the Register
 * button, and the Manage notices cannot disagree about what the wallet
 * is doing.
 */
export function walletStatusCta(status: WalletStatus): WalletStatusCta | null {
  switch (status.state) {
    case "connected":
      return null;
    case "detecting":
      return {
        action: "retry",
        label: "Detecting wallet…",
        title: "Looking for Arch Wallet",
        message: "Checking whether the Arch Wallet extension is installed on this browser.",
      };
    case "no_extension":
      return {
        action: "choose_wallet",
        label: "Connect wallet",
        title: "Connect a wallet to continue",
        message:
          "Search works without a wallet. Registering and managing names needs a " +
          "connected wallet (Arch Wallet, Xverse, UniSat, Leather, or Phantom) to " +
          "approve the transaction.",
      };
    case "not_initialized":
      return {
        // Deliberately `connect`, not `retry`. A re-read asks the one
        // question that cannot answer this — it reports "Wallet locked"
        // whether or not a wallet exists — so `retry` here is a button
        // that puts the wrong state back on screen. `connect()` is the
        // call that observes the truth, and the call that succeeds the
        // moment the user has finished setting the wallet up.
        action: "connect",
        label: "Connect wallet",
        title: "Arch Wallet isn't ready for this site yet",
        message:
          "Arch Wallet is installed, but the extension has no wallet in it that it " +
          "can offer this site — so it is not locked, and there is nothing to " +
          "unlock. Open Arch Wallet from the Chrome toolbar, finish creating or " +
          "importing a wallet, make sure an account is selected on Testnet, then " +
          "connect again. If you do already have a wallet there, check whether a " +
          "second copy of the Arch Wallet extension is installed — only the first " +
          "one to load can answer this page. Nothing has been sent to the network.",
        secondaryAction: "retry",
        secondaryLabel: "Check again",
      };
    case "locked":
      return {
        action: "unlock",
        label: "Unlock Arch Wallet",
        title: "Arch Wallet is locked",
        message:
          "Your wallet is locked, so it cannot tell this site which account is " +
          "connected. Unlock it here or from the Arch Wallet icon in your Chrome " +
          "toolbar — either way this page notices within a few seconds and " +
          "updates itself. Nothing has been sent to the network.",
        // Unlocking from the toolbar icon leaves this tab visible and
        // unfocused, so the page has no event to react to and re-reads on
        // a timer instead. This is the button for when that feels slow —
        // a read, not a second unlock prompt.
        secondaryAction: "retry",
        secondaryLabel: "I've unlocked — check again",
      };
    case "awaiting_wallet":
      return {
        action: status.intent,
        label: status.canReprompt ? "Open Arch Wallet again" : "Waiting for Arch Wallet…",
        title: "Waiting for Arch Wallet",
        message:
          `Arch Wallet has been asked to ${status.intent}, and the request is open ` +
          `in its window. Finish there and this page updates on its own — no need ` +
          `to click again. ${FIND_THE_WINDOW} Nothing has been sent to the network.`,
      };
    case "prompt_unanswered":
      return promptUnansweredCta(status);
    case "not_connected":
      return {
        action: "choose_wallet",
        label: "Connect wallet",
        title: "Wallet not connected",
        message:
          "This site is not connected to a wallet yet. Connect Arch Wallet or another " +
          "supported Bitcoin wallet and choose the account you want to use, then continue.",
      };
    case "stale_extension":
      return {
        action: "reload",
        label: "Reload page",
        title: "Arch Wallet needs a page refresh",
        message:
          "The Arch Wallet extension was updated or reloaded, so this page is still " +
          "holding its old connection to it. Reload this page to reconnect. Nothing " +
          "was sent to the wallet and nothing changed on-chain.",
      };
    case "unsupported_account":
      return {
        action: "reconnect",
        label: "Switch account",
        title: "This wallet account can't sign",
        message:
          "Arch Wallet is offering a watch-only or linked external account, which " +
          "cannot sign ANS transactions. Reconnect and choose an account the " +
          "extension holds keys for.",
      };
    case "unavailable":
      return {
        action: "retry",
        label: "Check wallet again",
        title: "Arch Wallet did not respond",
        message:
          "The extension is installed but did not answer the account check. Try again, " +
          "or reload the page if it keeps failing.",
      };
  }
}

/** How long a prompt runs before we offer to open the window again. */
export const REPROMPT_AFTER_MS = 6_000;

/**
 * Whether the CTA button should be inert.
 *
 * `awaiting_wallet` is the case worth spelling out. A prompt is running,
 * so every other rule says "disabled" — but the window it opened may be
 * behind the browser where the user will never find it, and a disabled
 * button is then a dead end with a spinner on it. After a few seconds we
 * hand the button back: clicking it abandons the lost window and opens a
 * fresh one.
 */
export function walletCtaDisabled(status: WalletStatus, busy: boolean): boolean {
  if (status.state === "detecting") return true;
  if (status.state === "awaiting_wallet") return !status.canReprompt;
  return busy;
}

/**
 * Whether a status is the app's fault or the user's next move.
 *
 * Only a genuinely unreachable extension is an error. A prompt the user
 * has not finished is a normal step, and colouring it red taught people
 * that unlocking their wallet had broken something.
 */
export function walletStatusTone(status: WalletStatus): "error" | "warning" {
  if (status.state === "unavailable") return "error";
  if (status.state === "prompt_unanswered" && status.reason === "error") return "error";
  return "warning";
}

/** The raw extension message behind a status, when there is one. */
export function walletStatusDetail(status: WalletStatus): string | undefined {
  if (status.state === "unavailable") return status.detail;
  if (status.state === "prompt_unanswered") return status.detail;
  return undefined;
}
