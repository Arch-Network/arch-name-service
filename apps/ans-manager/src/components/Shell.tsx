import { Link, NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { useArchWallet } from "../hooks/useArchWallet";
import { useWalletRecovery } from "../hooks/useWalletRecovery";
import { shortArchAddress } from "../lib/arch-identity";
import { walletCtaDisabled, walletStatusCta } from "../lib/wallet-status";
import { ExplorerLink } from "./ExplorerLink";

/** Arch Prime glyph path (viewBox 0 0 544 393). */
const BRAND_GLYPH_D =
  "M92.3 392.3H5.5C1.2 392.3-1.4 387.6.8 384L226.9 24.7C236.7 9.3 253.5 0 272 0s35.3 9.2 45 24.7L543.1 384c2.3 3.6-.3 8.3-4.7 8.3H451.2c-1.9 0-3.7-1-4.7-2.6L306.3 166.2c-3.7-5.9-8.8-10.6-14.7-13.9-5.9-3.3-12.6-5-19.7-5-14.1 0-26.9 7-34.4 18.9L97 389.8c-1 1.6-2.8 2.5-4.7 2.5Z";

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
          <Link className="brand" to="/" aria-label="Arch ID home">
            <svg className="brand-glyph" viewBox="0 0 544 393" aria-hidden="true">
              <path d={BRAND_GLYPH_D} />
            </svg>
            <span className="brand-name">Arch ID</span>
            <span className="network-pill">
              <span className="network-dot" aria-hidden />
              Testnet
            </span>
          </Link>
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
        <p>
          <svg className="footer-glyph" viewBox="0 0 544 393" aria-hidden="true">
            <path d={BRAND_GLYPH_D} />
          </svg>
          Arch ID · Testnet
        </p>
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
