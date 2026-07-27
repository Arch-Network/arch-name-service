export {};

declare global {
  interface Window {
    arch?: {
      connect(): Promise<{ address: string; publicKey: string; archAddress: string }>;
      disconnect?(): Promise<void>;
      getAccount?(): Promise<{ address: string; publicKey: string; archAddress: string } | null>;
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
