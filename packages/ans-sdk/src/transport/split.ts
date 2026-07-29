import { createArchRpcTransport } from "./arch-rpc.js";
import { createExplorerRestTransport, type ExplorerRestOptions } from "./explorer-rest.js";
import type { AnsTransport } from "./types.js";

/**
 * Browser transport with an explicit read/write boundary:
 * - native Explorer REST handles transaction, height, and block reads;
 * - JSON-RPC handles transaction submission;
 * - account-state reads remain on compatibility RPC because Explorer REST does
 *   not expose raw account bytes or program-owned account state.
 */
export function createSplitAnsTransport(options: {
  rpcUrl: string;
  explorerUrl: string;
  explorer?: ExplorerRestOptions;
}): AnsTransport {
  const rpc = createArchRpcTransport(options.rpcUrl);
  const explorer = createExplorerRestTransport(options.explorerUrl, options.explorer);

  return {
    readAccountInfo: rpc.readAccountInfo,
    getMultipleAccounts: rpc.getMultipleAccounts,
    getProgramAccounts: rpc.getProgramAccounts,
    getCurrentSlot: explorer.getCurrentSlot,
    getBestBlockHash: explorer.getBestBlockHash,
    sendTransaction: rpc.sendTransaction,
    getProcessedTransaction: explorer.getProcessedTransaction,
  };
}
