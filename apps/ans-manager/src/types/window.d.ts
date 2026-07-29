export {};

type ArchProviderAccount = {
  address: string;
  publicKey: string;
  archAddress: string;
  /** Optional; newer extensions may report turnkey | external | watch. */
  kind?: string;
};

declare global {
  /** Injected by Vite's `define`; see `buildStamp()` in vite.config.ts. */
  const __ANS_BUILD__: string;

  interface Window {
    /** The running bundle's build stamp, for support conversations. */
    __ansBuild?: string;
    arch?: {
      connect(): Promise<ArchProviderAccount>;
      disconnect?(): Promise<void>;
      getAccount?(): Promise<ArchProviderAccount | null>;
      signArchMessageHash(
        messageHash: Uint8Array,
      ): Promise<
        | Uint8Array
        | { signature: Uint8Array | string; signature64Hex?: string }
        | { signature64Hex: string }
      >;
    };
  }
}
