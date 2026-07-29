import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { useArchWallet } from "../hooks/useArchWallet";

export function Shell() {
  const { available, account, connect, connecting, error } = useArchWallet();
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");

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
            {account ? (
              <span className="address-chip mono" title={account.archAddress}>
                {account.archAddress.slice(0, 6)}…{account.archAddress.slice(-4)}
              </span>
            ) : (
              <button className="btn btn-primary connect-btn" disabled={!available || connecting} onClick={() => void connect()}>
                {connecting ? "Connecting…" : available ? "Connect wallet" : "Detecting wallet…"}
              </button>
            )}
          </div>
        </div>
        <nav className="nav" aria-label="ANS navigation">
          <NavLink to="/" end>Search</NavLink>
          <NavLink to="/register">Register</NavLink>
          <NavLink to="/manage">Manage</NavLink>
          <NavLink to="/names">My names</NavLink>
        </nav>
      </header>
      <main className="page-content">
        {error ? <p className="status-banner status-err">{error}</p> : null}
        {!available ? (
          <p className="status-banner status-warn">
            Looking for Arch Wallet. Unlock the extension, allow it on this site, then refresh.
            Search remains available without connecting.
          </p>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
