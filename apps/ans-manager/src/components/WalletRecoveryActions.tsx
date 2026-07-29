import { InstallArchWalletLink } from "./InstallArchWalletLink";
import type { WalletStatusAction } from "../lib/wallet-status";

const BUSY_LABELS: Record<WalletStatusAction, string> = {
  unlock: "Waiting for wallet…",
  connect: "Connecting…",
  choose_wallet: "Opening wallets…",
  reconnect: "Reconnecting…",
  reload: "Reloading…",
  adopt: "Switching account…",
  retry: "Checking…",
  install: "Opening wallets…",
};

/**
 * Primary call-to-action for a recoverable wallet state (locked, not
 * connected, wrong account). Rendered inside the error notice so the user
 * can clear the blocker without hunting for the extension icon.
 *
 * A second action appears only when the notice offers a real choice —
 * today that is "use the account the wallet is offering" (primary) versus
 * "reconnect and pick another" (secondary).
 */
export function WalletRecoveryActions({
  action,
  label,
  secondaryAction,
  secondaryLabel,
  working,
  disabled,
  promptOpen,
  onRun,
}: {
  action: WalletStatusAction;
  label: string;
  secondaryAction?: WalletStatusAction;
  secondaryLabel?: string;
  /** The action currently running, if any. */
  working: WalletStatusAction | null;
  disabled?: boolean;
  /**
   * A wallet window is open right now. `disabled` and `label` are then
   * the whole truth: the button is the offer to re-open a window the
   * user cannot find, so neither the running-action lockout nor the
   * generic busy label may override them.
   */
  promptOpen?: boolean;
  onRun: (action: WalletStatusAction) => void;
}) {
  if (action === "install") {
    return (
      <div className="actions">
        <InstallArchWalletLink>{label}</InstallArchWalletLink>
      </div>
    );
  }
  return (
    <div className="actions">
      <button
        type="button"
        className="btn btn-primary"
        disabled={promptOpen ? disabled : disabled || working !== null}
        onClick={() => onRun(action)}
      >
        {!promptOpen && working === action ? BUSY_LABELS[action] : label}
      </button>
      {secondaryAction ? (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled || working !== null}
          onClick={() => onRun(secondaryAction)}
        >
          {working === secondaryAction
            ? BUSY_LABELS[secondaryAction]
            : (secondaryLabel ?? "Reconnect site")}
        </button>
      ) : null}
      {/* A stale extension context is not a missing extension — offering
          "install" there sends the user to the store for nothing, and
          neither is a wallet that answered but signed as someone else.
          The mismatch notice already has two buttons; a third is noise. */}
      {action === "reload" || action === "retry" || secondaryAction ? null : (
        <InstallArchWalletLink className="btn btn-secondary" />
      )}
    </div>
  );
}
