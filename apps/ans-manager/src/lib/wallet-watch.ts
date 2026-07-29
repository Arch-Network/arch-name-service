/**
 * How the app notices a wallet that changed somewhere else.
 *
 * Every state in `wallet-status.ts` is a reading, and every reading is
 * taken because something happened *here* — the page mounted, the tab
 * regained focus, a prompt finished. That is the whole bug this module
 * exists for: unlocking the wallet does not happen here. The user clicks
 * the extension icon, types their password in a panel anchored to the
 * toolbar, and leaves the ANS tab exactly as it was — visible, never
 * re-focused, never re-read. The page kept showing "Arch Wallet is
 * locked" next to a wallet that was plainly unlocked, and no amount of
 * waiting fixed it because nothing was scheduled to look again.
 *
 * So while the app is blocked it watches, on a timer, with reads only.
 * Two rules keep that from being obnoxious:
 *
 *   1. Reads never open a window. `getAccount()` is popup-free;
 *      `connect()` is never issued on a timer, only from a click.
 *   2. A read may not overwrite an answer the user is part of. A poll
 *      that reports `locked` while an unlock prompt is open is not news
 *      — it is the wallet describing the screen the user is typing into.
 */

import { statusAccount, type WalletStatus } from "./wallet-status";

/**
 * Whether the app is waiting on something it cannot cause.
 *
 * `detecting` and `no_extension` are excluded because there is no
 * provider to read, and the detection loop already owns that interval.
 * `stale_extension` is excluded because every read against a dead
 * extension context fails the same way; only a reload clears it.
 */
export function isBlockedWalletStatus(status: WalletStatus): boolean {
  switch (status.state) {
    case "connected":
    case "detecting":
    case "no_extension":
    case "stale_extension":
      return false;
    default:
      return true;
  }
}

/** First interval after a blocked state appears, or a user signal. */
export const WALLET_POLL_MIN_MS = 2_500;
/** Ceiling, so an abandoned tab settles into a heartbeat. */
export const WALLET_POLL_MAX_MS = 15_000;
/** Reads before the watch stands down until the next user signal. */
export const WALLET_POLL_ATTEMPTS = 40;

/**
 * Backing off matters more than it looks. The common case is resolved in
 * the first few seconds — the user unlocks, sees the page catch up — and
 * the long tail is a tab left open on a locked wallet for an hour, where
 * a fixed 2.5s poll is thousands of pointless round trips. Focus,
 * pointer input and the tab becoming visible all reset it to fast.
 */
export function nextPollDelay(attempt: number): number {
  const delay = WALLET_POLL_MIN_MS * 1.5 ** Math.max(0, attempt);
  return Math.min(Math.round(delay), WALLET_POLL_MAX_MS);
}

/** States whose whole purpose is to narrate a prompt the user is in. */
function narratesPrompt(status: WalletStatus): boolean {
  return status.state === "awaiting_wallet" || status.state === "prompt_unanswered";
}

/**
 * Whether a read taken in the background may replace what is on screen.
 *
 * The one case that must always win is a reading that names an account:
 * that is the wallet serving this origin again, which is the outcome
 * every blocked state is waiting for, and adopting it is what lets an
 * out-of-band unlock resolve with no click at all.
 *
 * Against a prompt state the rule inverts. "Wallet locked" is the honest
 * answer for the entire time the user spends typing their password, and
 * writing it would replace "Waiting for Arch Wallet" with the button
 * they just pressed — the loop this app has already been fixed for once.
 * The same applies after a prompt ends without an answer: "the Arch
 * Wallet window closed" explains what happened, and decaying into
 * "Arch Wallet is locked" a few seconds later throws that away.
 *
 * Conditions a re-prompt cannot fix are the exception: if the extension
 * has since gone, or has no wallet in it, the prompt narration is
 * describing something that no longer exists.
 */
export function shouldAdoptProbe(current: WalletStatus, probed: WalletStatus): boolean {
  if (statusAccount(probed)) return true;
  if (!narratesPrompt(current)) return true;
  return (
    probed.state === "no_extension" ||
    probed.state === "not_initialized" ||
    probed.state === "stale_extension"
  );
}

/**
 * Whether two readings say the same thing.
 *
 * Polling produces a fresh object every few seconds, and handing React a
 * new `{ state: "locked" }` on each one re-renders every view and — worse
 * — restarts any effect keyed on the status, which is how a backoff
 * schedule silently becomes a fixed interval.
 */
export function sameWalletStatus(a: WalletStatus, b: WalletStatus): boolean {
  if (a.state !== b.state) return false;
  const accountA = statusAccount(a);
  const accountB = statusAccount(b);
  if (accountA || accountB) {
    return accountA?.archAddress === accountB?.archAddress && accountA?.kind === accountB?.kind;
  }
  if (a.state === "awaiting_wallet" && b.state === "awaiting_wallet") {
    return a.intent === b.intent && a.canReprompt === b.canReprompt;
  }
  if (a.state === "prompt_unanswered" && b.state === "prompt_unanswered") {
    return a.intent === b.intent && a.reason === b.reason && a.detail === b.detail;
  }
  if (a.state === "unavailable" && b.state === "unavailable") {
    return a.detail === b.detail;
  }
  return true;
}
