import { ARCH_EXTENSION_STORE_URL } from "../lib/chrome-store";

type InstallArchWalletLinkProps = {
  className?: string;
  children?: string;
};

/** Primary Chrome Web Store CTA using existing `.btn` styles. */
export function InstallArchWalletLink({
  className = "btn btn-primary",
  children = "Install Arch Wallet",
}: InstallArchWalletLinkProps) {
  return (
    <a
      className={className}
      href={ARCH_EXTENSION_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}
