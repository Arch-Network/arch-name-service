/**
 * Active ANS wallet port for non-React submit paths.
 *
 * `submitWithWindowArch` lives outside React; the provider registers the
 * current port here whenever kit / Arch session state changes. Fee payer and
 * signer always come from this port at submit time — never a stale header
 * snapshot alone.
 */

import type { AnsWalletPort } from "./ans-wallet-port";

let activePort: AnsWalletPort | null = null;
let portEpoch = 0;

export function setActiveAnsWalletPort(port: AnsWalletPort | null): void {
  activePort = port;
  portEpoch += 1;
}

export function getActiveAnsWalletPort(): AnsWalletPort | null {
  return activePort;
}

export function getAnsWalletPortEpoch(): number {
  return portEpoch;
}

/** Test-only. */
export function __resetActiveAnsWalletPort(): void {
  activePort = null;
  portEpoch = 0;
}
