import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { useArchWallet } from "../hooks/useArchWallet";
import { useWalletRecovery } from "../hooks/useWalletRecovery";
import { shortArchAddress } from "../lib/arch-identity";
import { walletCtaDisabled, walletStatusCta } from "../lib/wallet-status";
import { ExplorerLink } from "./ExplorerLink";

export function Shell() {
  const { status, reportedAccount, connecting, error, openWalletPicker } = useArchWallet();
  const recovery = useWalletRecovery();
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const cta = walletStatusCta(status);
  const busy = connecting || recovery.working !== null;
  const providerLabel =
    reportedAccount?.providerLabel ??
    (reportedAccount?.providerId === "arch-extension" ? "Arch Wallet" : null);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      root.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const runHeaderCta = () => {
    if (!cta) return;
    if (
      cta.action === "choose_wallet" ||
      cta.action === "connect" ||
      cta.action === "install"
    ) {
      openWalletPicker();
      return;
    }
    void recovery.run(cta.action);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-main">
          <div className="brand">
            <img className="brand-swap-light" src="/brand/arch-logo-orange.svg" alt="Arch" />
            <img className="brand-swap-dark" src="/brand/arch-logo-cream.svg" alt="Arch" />
            <span className="network-pill">
              <span className="network-dot" aria-hidden />
              Testnet
            </span>
          </div>
          <nav className="nav" aria-label="ANS navigation">
            <NavLink to="/" end>Discover</NavLink>
            <NavLink to="/explore">Marketplace</NavLink>
            <NavLink to="/manage">Manage</NavLink>
            <NavLink to="/names">My names</NavLink>
          </nav>
          <div className="header-actions">
            <select
              className="theme-select"
              aria-label="Theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as typeof theme)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            {reportedAccount ? (
              <ExplorerLink
                kind="account"
                value={reportedAccount.archAddress}
                className="address-chip mono"
              >
                {providerLabel ? (
                  <span className="address-chip-provider">{providerLabel}</span>
                ) : null}
                <span className="address-chip-addr">
                  {shortArchAddress(reportedAccount.archAddress)}
                </span>
              </ExplorerLink>
            ) : !cta ? null : (
              <button
                className="btn btn-primary connect-btn"
                disabled={walletCtaDisabled(status, busy)}
                onClick={runHeaderCta}
              >
                {busy && status.state !== "awaiting_wallet" ? "Waiting for wallet…" : cta.label}
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="page-content">
        {error && !cta ? (
          <p className="wallet-error" role="alert">Wallet connection failed. {error}</p>
        ) : null}
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>Arch Name Service · Testnet</p>
        <nav aria-label="Support links">
          <a href="https://github.com/Arch-Network/arch-name-service" target="_blank" rel="noreferrer">
            Documentation
          </a>
          <a href="https://explorer.arch.network/testnet" target="_blank" rel="noreferrer">
            Network status
          </a>
        </nav>
      </footer>
    </div>
  );
}
