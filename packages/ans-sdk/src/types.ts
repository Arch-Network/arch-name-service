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

export type RecordType = "ArchOwner" | "BitcoinTaproot" | "TokenAta" | "Text";

export type RecordValue =
  | { kind: "ArchOwner"; owner: ArchAddress }
  | { kind: "BitcoinTaproot"; witnessProgram: Uint8Array }
  | { kind: "TokenAta"; tokenId: ArchAddress; ata: ArchAddress }
  | { kind: "Text"; key: string; value: string };

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

export type QuoteCurrency = "Arch" | "Btc";

export interface ListingAccount {
  header: AccountHeader;
  nameHash: Uint8Array;
  seller: ArchAddress;
  currency: QuoteCurrency;
  price: bigint;
  createdAtSlot: bigint;
  active: boolean;
}

/** Buyer offer against a registered name. ARCH escrows lamports in the offer PDA. */
export interface OfferAccount {
  header: AccountHeader;
  nameHash: Uint8Array;
  buyer: ArchAddress;
  currency: QuoteCurrency;
  price: bigint;
  createdAtSlot: bigint;
  active: boolean;
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

export interface AnsDeploymentFeatures {
  /** When true, the live program accepts RecordType::Text PDAs. */
  textRecords: boolean;
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
  features?: AnsDeploymentFeatures;
}
