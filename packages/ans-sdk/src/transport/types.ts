export type AccountInfo = {
  data: Uint8Array;
  owner: Uint8Array;
  lamports: number;
  isExecutable: boolean;
};

export type ProgramAccountEntry = {
  pubkey: Uint8Array;
  account: AccountInfo;
};

export type ProcessedTransaction = {
  status: "Processed" | "Failed" | string;
  error?: string;
};

export interface AnsTransport {
  readAccountInfo(pubkey: Uint8Array | string): Promise<AccountInfo | null>;
  getProgramAccounts?(
    programId: Uint8Array | string,
    filters?: Array<{ DataSize: number } | { DataContent: { offset: number; bytes: number[] } }>,
  ): Promise<ProgramAccountEntry[]>;
  getCurrentSlot(): Promise<bigint>;
  getBestBlockHash(): Promise<Uint8Array>;
  sendTransaction(transaction: unknown): Promise<string>;
  getProcessedTransaction(txid: string): Promise<ProcessedTransaction | null>;
}
