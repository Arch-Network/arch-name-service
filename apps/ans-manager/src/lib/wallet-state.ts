/**
 * Recoverable Arch Wallet states, and the copy each one needs.
 *
 * These all arrive as plain `Error`s: the extension's provider forwards
 * only `error.message` across the page bridge, so classification has to
 * be string-based. Keeping it in one module is what stops every view
 * from growing its own regex — and stops a locked or disconnected
 * wallet from looking like "your name update is broken".
 */

/** A wallet state the user can clear in one step. */
export type WalletBlockerKind =
  | "locked"
  | "not_connected"
  | "needs_reconnect"
  | "unsupported_kind"
  | "stale_extension"
  /** The wallet signed, but with a key that is not the fee payer. */
  | "signer_mismatch";

/**
 * Which recovery action the notice should offer.
 *
 * `adopt` is the one-click resolution for an account mismatch: keep the
 * site connection, re-read the account the wallet is actually offering,
 * and rebuild the action around it. It exists because "reconnect" asks
 * the user to make a choice they have no basis for — both accounts work,
 * the page just pinned the other one.
 */
export type WalletRecoveryAction =
  | "unlock"
  | "connect"
  | "reconnect"
  | "reload"
  /** Re-read wallet state without prompting; the user fixed it elsewhere. */
  | "retry"
  | "adopt";

/**
 * Chrome's wording for "the page is talking to an extension context that
 * no longer exists" — the extension was reloaded, updated, or disabled
 * while this tab kept its injected provider and content-script port. The
 * only fix is a page refresh; nothing reached the wallet, so nothing
 * reached the chain either.
 */
const STALE_EXTENSION_PATTERNS =
  /extension context invalidated|attempting to use a disconnected port object|could not establish connection\.? receiving end does not exist|message port closed before a response was received/i;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

export function classifyWalletBlocker(error: unknown): WalletBlockerKind | null {
  const code = errorCode(error);
  // Multi-approval flows wrap failures with the phase they happened in.
  // Classify the underlying wallet error, not the wrapper.
  if (code === "ANS_STEP_FAILED") {
    return classifyWalletBlocker((error as { cause?: unknown }).cause);
  }
  if (code === "UNSUPPORTED_WALLET_KIND") return "unsupported_kind";
  if (code === "SIGNER_MISMATCH") return "signer_mismatch";
  if (code === "WALLET_ACCOUNT_CHANGED") return "needs_reconnect";
  if (code === "WALLET_LOCKED") return "locked";
  if (code === "SITE_NOT_CONNECTED") return "not_connected";

  const raw = errorMessage(error);
  if (STALE_EXTENSION_PATTERNS.test(raw)) return "stale_extension";
  if (/wallet (is )?locked|keystore is locked/i.test(raw)) return "locked";
  if (/site not connected|not connected to this site/i.test(raw)) return "not_connected";
  // A node-side signature-check failure means the wallet signed with a key
  // that is not the fee payer. Reconnecting the site does not change which
  // key the released extension signs with, so this is deliberately not
  // classified as `needs_reconnect`.
  if (
    /error checking transaction sigs|bip322 signature verification failed|signature did not match/i.test(
      raw,
    )
  ) {
    return "signer_mismatch";
  }
  if (/connected site account is no longer available|wallet account changed/i.test(raw)) {
    return "needs_reconnect";
  }
  if (/linked external|watch-only wallets cannot sign/i.test(raw)) {
    return "unsupported_kind";
  }
  return null;
}

export type WalletBlockerNotice = {
  title: string;
  message: string;
  action: WalletRecoveryAction | null;
  /** Label for the recovery button. */
  actionLabel: string;
  /** Offered alongside the primary action when there is a real choice. */
  secondaryAction?: WalletRecoveryAction;
  secondaryActionLabel?: string;
};

/** The two accounts involved in a mismatch, when we know them. */
export type AccountMismatchContext = {
  /** Short form of the account the page built the transaction for. */
  pinnedShort: string;
  /** Short form of the account the wallet is offering now. */
  currentShort: string;
  /** `external` / `watch` when the current account cannot sign at all. */
  currentKind?: string;
  /** Short form of the key that actually produced the signature, if known. */
  signerShort?: string | null;
};

/**
 * The account mix-up that reconnecting cannot fix.
 *
 * This build of the extension answers "which account is connected?" from
 * the site binding, but signs with whichever account is *active* in the
 * wallet. When those are two different accounts the signature never
 * matches the fee payer, and rebinding the origin — the advice this app
 * used to give — changes nothing, because the sign path never consults
 * the binding. The one action that works is switching the wallet's
 * active account, on its home screen, to the account named here.
 *
 * The app resolves this on its own whenever it can recognize the signing
 * key, so this notice is what is left over: the wallet signed as an
 * account this browser has never been told about.
 */
function signerMismatchNotice(
  retryLabel: string,
  context: AccountMismatchContext | undefined,
): WalletBlockerNotice {
  const payer = context?.pinnedShort;
  const target = payer ? `${payer}, the account shown in the header,` : "the account shown in the header";
  const evidence = context?.signerShort
    ? `Arch Wallet produced a valid signature from ${context.signerShort}, but this ` +
      `transaction is paid for by ${payer ?? "another account"}, so the network would ` +
      `reject it.`
    : `Arch Wallet's signature does not belong to the account paying for this ` +
      `transaction, and does not match any account this browser has seen the wallet ` +
      `report.`;
  return {
    title: "Arch Wallet signed with a different account",
    message:
      `${evidence} We checked before submitting, so nothing was sent to the network ` +
      `and no funds moved. This build of Arch Wallet signs with whichever account is ` +
      `active in the extension, not the account a site is connected to — reconnecting ` +
      `will not change that. Open Arch Wallet, make ${target} the active one on its ` +
      `home screen, then ${retryLabel} again.`,
    action: "retry",
    actionLabel: "Check the wallet again",
  };
}

/** Account kinds that cannot produce an Arch message-hash signature. */
function isUnsignableKind(kind: string | undefined): boolean {
  return kind === "external" || kind === "watch";
}

/**
 * The account-mismatch notice, which is the one users get stuck on.
 *
 * Two things make it actionable: naming both accounts, so the user can
 * see this is an identity mix-up and not a broken registration, and
 * leading with "use the account the wallet is offering" — the resolution
 * that needs no decision from them. Reconnecting stays available for the
 * case where they actually do want a different account.
 */
function accountMismatchNotice(
  retryLabel: string,
  context: AccountMismatchContext | undefined,
): WalletBlockerNotice {
  if (!context) {
    return {
      title: "Wallet account didn't match",
      message:
        `Arch Wallet offered a different account than this page was set up to ` +
        `pay with, so nothing was signed and no funds moved. Reconnect the site ` +
        `to the account you want to use, then ${retryLabel} again.`,
      action: "reconnect",
      actionLabel: "Reconnect wallet",
    };
  }
  // A watch-only or linked external account can't sign, so adopting it
  // would only move the failure one step later. Say why, and send the
  // user to the picker.
  if (isUnsignableKind(context.currentKind)) {
    return {
      title: "This wallet account can't sign",
      message:
        `This page was set up to pay with ${context.pinnedShort}, but Arch Wallet ` +
        `is now offering ${context.currentShort}, which is ` +
        `${context.currentKind === "watch" ? "watch-only" : "a linked external wallet"} ` +
        `and cannot sign ANS transactions. Nothing was signed and no funds moved. ` +
        `Reconnect and choose an account the wallet holds keys for, then ` +
        `${retryLabel} again.`,
      action: "reconnect",
      actionLabel: "Reconnect wallet",
    };
  }
  return {
    title: "Arch Wallet switched accounts",
    message:
      `This page was set up to pay with ${context.pinnedShort}, but Arch Wallet ` +
      `is now offering ${context.currentShort}. Nothing was signed and no funds ` +
      `moved. Use ${context.currentShort} and we'll rebuild and ${retryLabel} ` +
      `with it, or reconnect the site to pick a different account.`,
    action: "adopt",
    actionLabel: `Use ${context.currentShort} instead`,
    secondaryAction: "reconnect",
    secondaryActionLabel: "Reconnect site",
  };
}

/**
 * @param retryLabel What the user was trying to do, e.g. "Set as primary".
 * @param context Both account identities, when the blocker is a mismatch.
 */
export function walletBlockerNotice(
  kind: WalletBlockerKind,
  retryLabel: string,
  context?: AccountMismatchContext,
): WalletBlockerNotice {
  switch (kind) {
    case "locked":
      return {
        title: "Arch Wallet is locked",
        message:
          `Your wallet is locked, so nothing was signed and nothing changed ` +
          `on-chain. Unlock Arch Wallet below — it opens the extension window ` +
          `for your password — then ${retryLabel} again.`,
        action: "unlock",
        actionLabel: "Unlock Arch Wallet",
      };
    case "not_connected":
      return {
        title: "Wallet not connected",
        message:
          `This site isn't connected to your Arch Wallet yet. ` +
          `Connect it, then ${retryLabel} again. Nothing was changed on-chain.`,
        action: "connect",
        actionLabel: "Connect wallet",
      };
    case "needs_reconnect":
      return accountMismatchNotice(retryLabel, context);
    case "signer_mismatch":
      return signerMismatchNotice(retryLabel, context);
    case "stale_extension":
      return {
        title: "Arch Wallet needs a page refresh",
        message:
          `The Arch Wallet extension was updated or reloaded, so this page is ` +
          `still holding its old connection to it. Nothing was sent to the ` +
          `wallet and nothing changed on-chain. Reload this page, then ` +
          `${retryLabel} again.`,
        action: "reload",
        actionLabel: "Reload page",
      };
    case "unsupported_kind":
      return {
        title: "This wallet account can't sign",
        message:
          "Signing an ANS update needs an Arch Wallet account the extension holds " +
          "keys for — one you created with a passkey or an email. Linked external " +
          "wallets (Xverse, UniSat) and watch-only accounts cannot sign these " +
          `transactions yet. Reconnect, choose one of those accounts, then ` +
          `${retryLabel} again.`,
        action: "reconnect",
        actionLabel: "Reconnect wallet",
      };
  }
}
