export type ArchAddress = Uint8Array;

export type BitcoinNetwork = "mainnet" | "testnet" | "signet" | "regtest";

export interface AccountHeader {
  discriminator: Uint8Array;
  initialized: boolean;
  stateVersion: number;
}

export interface TokenProgramConfig {
  tokenProgramId: ArchAddress;
  associatedTokenProgramId: ArchAddress;
}

export interface RegistryConfig {
  header: AccountHeader;
  programVersion: number;
  networkId: number;
  namespace: string;
  namespaceAuthority: ArchAddress;
  gracePeriodSlots: bigint;
  minRegistrationSlots: bigint;
  maxRegistrationSlots: bigint;
  bitcoinNetwork: BitcoinNetwork;
  tokenPrograms: TokenProgramConfig[];
  paused: boolean;
  mainnetEnabled: boolean;
}

export interface NameAccount {
  header: AccountHeader;
  nameHash: Uint8Array;
  canonicalLabel: string;
  owner: ArchAddress;
  registeredAtSlot: bigint;
  expiresAtSlot: bigint;
  recordEpoch: bigint;
  primaryBindingNonce: bigint;
}

export type RecordType = "ArchOwner" | "BitcoinTaproot" | "TokenAta";

export type RecordValue =
  | { kind: "ArchOwner"; owner: ArchAddress }
  | { kind: "BitcoinTaproot"; witnessProgram: Uint8Array }
  | { kind: "TokenAta"; tokenId: ArchAddress; ata: ArchAddress };

export interface RecordAccount {
  header: AccountHeader;
  nameHash: Uint8Array;
  recordType: RecordType;
  ownerSnapshot: ArchAddress;
  recordEpoch: bigint;
  revision: bigint;
  value: RecordValue;
  updatedAtSlot: bigint;
}

export interface ReverseAccount {
  header: AccountHeader;
  owner: ArchAddress;
  primaryNameHash: Uint8Array;
  bindingNonce: bigint;
  updatedAtSlot: bigint;
}

export interface AccountAt<T> {
  address: ArchAddress;
  state: T;
}

export interface AccountMeta {
  pubkey: ArchAddress;
  isSigner: boolean;
  isWritable: boolean;
}

export interface BuiltInstruction {
  programId: ArchAddress;
  accounts: AccountMeta[];
  data: Uint8Array;
}

export interface AnsDeploymentManifest {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  programId: string;
  registryConfig: string;
  networkId: number;
  namespace: string;
  programVersion: number;
  bitcoinNetwork: BitcoinNetwork;
  tokenPrograms: Array<{
    tokenProgramId: string;
    associatedTokenProgramId: string;
  }>;
  mainnetEnabled: boolean;
  smokePassed?: boolean;
}
