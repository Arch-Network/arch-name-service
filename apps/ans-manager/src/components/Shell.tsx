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
        <div className="brand">
          <img className="brand-swap-light" src="/brand/arch-logo-orange.svg" alt="Arch" />
          <img className="brand-swap-dark" src="/brand/arch-logo-cream.svg" alt="Arch" />
          <span className="badge">Testnet</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Search
          </NavLink>
          <NavLink to="/register">Register</NavLink>
          <NavLink to="/manage">Manage</NavLink>
          <NavLink to="/names">My names</NavLink>
        </nav>
        <div className="row">
          <select
            className="input"
            style={{ width: "auto" }}
            value={theme}
            onChange={(e) => setTheme(e.target.value as typeof theme)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          {account ? (
            <span className="mono" title={account.archAddress}>
              {account.archAddress.slice(0, 6)}…{account.archAddress.slice(-4)}
            </span>
          ) : (
            <button className="btn btn-primary" disabled={!available || connecting} onClick={() => void connect()}>
              {connecting ? "Connecting…" : available ? "Connect wallet" : "Waiting for wallet…"}
            </button>
          )}
        </div>
      </header>
      {error ? <p className="status-err" style={{ marginBottom: 16 }}>{error}</p> : null}
      {!available ? (
        <p className="status-warn" style={{ marginBottom: 16 }}>
          Looking for Arch Wallet… If this persists, unlock the extension, confirm it is enabled for
          this site, then refresh. Search still works without connecting.
        </p>
      ) : null}
      <Outlet />
    </div>
  );
}
