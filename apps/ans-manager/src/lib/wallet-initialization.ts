/**
 * The one thing `getAccount()` cannot tell us, remembered from `connect()`.
 *
 * The released extension gates its two entry points on different facts:
 *
 *   GET_ACCOUNT  rejects "Wallet locked" when there is no *session key*
 *   CONNECT      rejects "Wallet not initialized" when there is no
 *                *keystore* at all
 *
 * An extension that has never had a wallet created in it has neither, so
 * it answers the read with "Wallet locked" — which is false. Nothing is
 * locked; there is nothing to unlock. The app believed it, showed "Arch
 * Wallet is locked" with an Unlock button, and the button called
 * `connect()`, which rejected instantly with "Wallet not initialized".
 * That answer was classified correctly for about two seconds, and then
 * the watch loop's next read reported "Wallet locked" again and put the
 * wrong state back on screen. Reloading did not help: the first read of
 * a fresh page is `getAccount()`, so the page came up lying again.
 *
 * `connect()`'s answer is strictly better evidence than the read's, and
 * it is the only place the truth is observable, so it is kept here. Once
 * "Wallet not initialized" has been seen, a subsequent "Wallet locked"
 * is known to be the ambiguous reading rather than news, and is reported
 * as what it actually is.
 *
 * The latch is not sticky against better evidence, which is what stops
 * it becoming a lie of its own:
 *
 *   - any read that names an account proves a keystore exists
 *   - so does "Site not connected", which the extension only answers
 *     *after* its unlock check passes — it implies a live session key,
 *     which implies a keystore was sealed and opened
 *
 * Either one clears it. A wallet the user sets up mid-session therefore
 * needs no reload; the next successful read resolves it.
 */

/** Whether `connect()` has reported that no keystore exists. */
let knownNotInitialized = false;

export function rememberNotInitialized(): void {
  knownNotInitialized = true;
}

/** Called on any observation that proves a keystore exists. */
export function clearNotInitialized(): void {
  knownNotInitialized = false;
}

export function isKnownNotInitialized(): boolean {
  return knownNotInitialized;
}

/** Test-only: forget what previous cases established. */
export function __resetWalletInitialization(): void {
  knownNotInitialized = false;
}
