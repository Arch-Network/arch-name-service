import { StatusNotice } from "./StatusNotice";
import { WalletRecoveryActions } from "./WalletRecoveryActions";
import {
  walletCtaDisabled,
  walletStatusCta,
  walletStatusDetail,
  walletStatusTone,
  type WalletStatus,
  type WalletStatusAction,
} from "../lib/wallet-status";

/**
 * The "you can't act yet, here's the one thing to do" banner.
 *
 * Every view renders this from the same status the header reads, which
 * is what keeps a page from offering "Approve registration" while the
 * wallet is locked — the situation that produced an unlock popup the
 * header claimed was unnecessary.
 */
export function WalletStatusNotice({
  status,
  working,
  disabled,
  onRun,
}: {
  status: WalletStatus;
  working: WalletStatusAction | null;
  disabled?: boolean;
  onRun: (action: WalletStatusAction) => void;
}) {
  const cta = walletStatusCta(status);
  // Nothing to say while the provider is still being detected: a banner
  // that appears for a quarter-second on every load is noise.
  if (!cta || status.state === "detecting") return null;
  return (
    <StatusNotice
      tone={walletStatusTone(status)}
      title={cta.title}
      message={cta.message}
      detail={walletStatusDetail(status)}
      detailOpen={false}
      action={
        <WalletRecoveryActions
          action={cta.action}
          label={cta.label}
          secondaryAction={cta.secondaryAction}
          secondaryLabel={cta.secondaryLabel}
          working={working}
          disabled={walletCtaDisabled(status, Boolean(disabled) || working !== null)}
          promptOpen={status.state === "awaiting_wallet"}
          onRun={onRun}
        />
      }
    />
  );
}
