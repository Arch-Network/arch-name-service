export type ExplorerNetwork = "mainnet" | "testnet";
export type ExplorerKind = "tx" | "account";

const EXPLORER_BASE: Record<ExplorerNetwork, string> = {
  mainnet: "https://explorer.arch.network",
  testnet: "https://explorer.arch.network/testnet",
};

/** ANS manager is testnet-focused; callers can override for mainnet. */
export const DEFAULT_EXPLORER_NETWORK: ExplorerNetwork = "testnet";

export function explorerUrl(opts: {
  kind: ExplorerKind;
  value: string;
  network?: ExplorerNetwork;
}): string {
  const network = opts.network ?? DEFAULT_EXPLORER_NETWORK;
  const base = EXPLORER_BASE[network];
  const value = encodeURIComponent(opts.value);
  if (opts.kind === "tx") return `${base}/tx/${value}`;
  return `${base}/accounts/${value}`;
}

export function explorerTxUrl(
  txid: string,
  network: ExplorerNetwork = DEFAULT_EXPLORER_NETWORK,
): string {
  return explorerUrl({ kind: "tx", value: txid, network });
}

export function explorerAccountUrl(
  address: string,
  network: ExplorerNetwork = DEFAULT_EXPLORER_NETWORK,
): string {
  return explorerUrl({ kind: "account", value: address, network });
}

export function truncateMiddle(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
