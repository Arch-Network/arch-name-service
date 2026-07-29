/**
 * Opt-in diagnostics for the manager.
 *
 * The wallet has its own switch (Settings → Diagnostics → debug mode)
 * which turns on the extension-side trail: `resolveSigningTarget` in the
 * background logs which account an origin resolved to, and
 * `approve:signing-with` logs which account actually produced the
 * signature. A page cannot read that setting, so the site carries the
 * matching switch for its half of the flow — turn both on and the two
 * trails line up request-by-request.
 *
 * Enable with `?debug=1` (sticky for the session's origin) or
 * `localStorage.setItem("ans:debug", "1")`. Off by default: these lines
 * carry account identities and belong in a support session, not in every
 * user's console.
 */

const STORAGE_KEY = "ans:debug";

let cached: boolean | null = null;

export function isDebugEnabled(): boolean {
  if (cached !== null) return cached;
  cached = false;
  if (typeof window === "undefined") return cached;
  try {
    const param = new URLSearchParams(window.location.search).get("debug");
    if (param === "1") window.localStorage.setItem(STORAGE_KEY, "1");
    if (param === "0") window.localStorage.removeItem(STORAGE_KEY);
    cached = window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private mode / blocked storage: diagnostics simply stay off.
  }
  return cached;
}

export function setDebugEnabled(enabled: boolean): void {
  cached = enabled;
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function debugLog(event: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug("[ans]", event, data ?? {});
}

/** Test-only: drop the memoized flag so a test can flip storage. */
export function __resetDebugCache(): void {
  cached = null;
}
