import {
  classifyNameAccountData,
  duplicateRegistrationError,
  type NameAvailability,
} from "../availability.js";
import {
  decodeListingAccount,
  decodeNameAccount,
  decodeRecordAccount,
  decodeRegistryConfig,
  decodeReverseAccount,
  LISTING_ACCOUNT_DISCRIMINATOR,
  NAME_ACCOUNT_DISCRIMINATOR,
  RECORD_ACCOUNT_DISCRIMINATOR,
  REGISTRY_CONFIG_DISCRIMINATOR,
  REVERSE_ACCOUNT_DISCRIMINATOR,
  validateHeader,
} from "../codec/state.js";
import {
  assertManifestConsistency,
  programIdBytes,
  registryConfigBytes,
} from "../config/manifest.js";
import {
  deriveListingAddress,
  deriveNameAddress,
  deriveRecordAddressFor,
  deriveReverseAddress,
} from "../derive.js";
import { AnsError } from "../errors.js";
import { bytesEqual, bytesToHex } from "../hex.js";
import {
  buildBuyNameInstruction,
  buildCancelListingInstruction,
  buildClearPrimaryInstruction,
  buildDeleteRecordInstruction,
  buildListNameInstruction,
  buildRegisterInstruction,
  buildSetPrimaryInstruction,
  buildSetRecordInstruction,
  buildTransferInstruction,
} from "../instructions/builders.js";
import { canonicalizeName, nameHash } from "../name.js";
import { manifestSupportsTextRecords } from "../records/catalog.js";
import {
  resolveOwner,
  resolvePrimary,
  resolveRecord,
} from "../resolve.js";
import type { AccountInfo, AnsTransport } from "../transport/types.js";
import type {
  AnsDeploymentManifest,
  ArchAddress,
  BuiltInstruction,
  ListingAccount,
  NameAccount,
  QuoteCurrency,
  RecordAccount,
  RecordType,
  RecordValue,
  RegistryConfig,
  ReverseAccount,
} from "../types.js";

export interface NameAvailabilityResult {
  canonical: string;
  availability: NameAvailability;
  account: NameAccount | null;
}

/** Newest `registeredAtSlot` first; when slots tie (common on testnet
 * while the program still stamps `0`), newer-looking labels last→first. */
export function selectRecentNames(
  entries: ReadonlyArray<{ name: string; account: NameAccount }>,
  limit: number,
): Array<{ name: string; account: NameAccount }> {
  const capped = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  return [...entries]
    .sort((a, b) => {
      if (a.account.registeredAtSlot === b.account.registeredAtSlot) {
        // Descending name: reverse of A→Z so the list reads newest-side first
        // when every account still has registeredAtSlot = 0.
        return a.name > b.name ? -1 : a.name < b.name ? 1 : 0;
      }
      return a.account.registeredAtSlot > b.account.registeredAtSlot ? -1 : 1;
    })
    .slice(0, capped);
}

export class AnsClient {
  readonly programId: ArchAddress;
  readonly registryConfigAddress: ArchAddress;

  constructor(
    readonly manifest: AnsDeploymentManifest,
    readonly transport: AnsTransport,
  ) {
    assertManifestConsistency(manifest);
    this.programId = programIdBytes(manifest);
    this.registryConfigAddress = registryConfigBytes(manifest);
  }

  supportsTextRecords(): boolean {
    return manifestSupportsTextRecords(this.manifest.features);
  }

  async fetchRegistryConfig(): Promise<RegistryConfig> {
    const account = await this.transport.readAccountInfo(this.registryConfigAddress);
    if (!account) throw new AnsError("AccountNotFound", "registry config missing");
    if (!bytesEqual(account.owner, this.programId)) {
      throw new AnsError("IncorrectProgramId");
    }
    const config = decodeRegistryConfig(account.data);
    validateHeader(config.header, REGISTRY_CONFIG_DISCRIMINATOR);
    return config;
  }

  async fetchNameAccount(name: string): Promise<NameAccount | null> {
    const status = await this.getNameAvailability(name);
    if (status.availability === "taken") return status.account;
    if (status.availability === "available") return null;
    throw new AnsError(
      "UnsupportedAccountVersion",
      `${status.canonical} name account is present but not a valid registration`,
    );
  }

  /**
   * Client-side registration gate. Missing/blank PDAs are available; initialized
   * NameAccounts are taken. Non-blank junk is unavailable (do not register into it).
   */
  async getNameAvailability(name: string): Promise<NameAvailabilityResult> {
    const canonical = canonicalizeName(name);
    const hash = nameHash(canonical);
    const address = deriveNameAddress(this.programId, this.manifest.namespace, hash);
    const accountInfo = await this.transport.readAccountInfo(address);
    if (!accountInfo || accountInfo.data.length === 0) {
      return { canonical, availability: "available", account: null };
    }
    if (!bytesEqual(accountInfo.owner, this.programId)) {
      throw new AnsError("IncorrectProgramId");
    }
    const classified = classifyNameAccountData(accountInfo.data);
    return { canonical, ...classified };
  }

  /** Throws `NameTaken` when the canonical name is already registered. */
  async assertNameAvailable(name: string): Promise<string> {
    const status = await this.getNameAvailability(name);
    if (status.availability === "taken") {
      throw duplicateRegistrationError(status.canonical);
    }
    if (status.availability === "unavailable") {
      throw new AnsError(
        "UnsupportedAccountVersion",
        `${status.canonical} cannot be registered (invalid on-chain name account)`,
      );
    }
    return status.canonical;
  }

  /**
   * Load a name account plus its typed/text records (and optional reverse) in
   * one `get_multiple_accounts` round trip when the transport supports it.
   *
   * Falls back to parallel single reads when batch is unavailable.
   */
  async fetchNameProfile(
    name: string,
    options: {
      textKeys?: readonly string[];
      /** When set, also loads this owner's reverse/primary binding. */
      primaryOwner?: ArchAddress;
    } = {},
  ): Promise<{
    nameAccount: NameAccount | null;
    archOwner: RecordAccount | null;
    taproot: RecordAccount | null;
    textByKey: Record<string, RecordAccount | null>;
    primaryName: string | null;
  }> {
    const canonical = canonicalizeName(name);
    const hash = nameHash(canonical);
    const textKeys = options.textKeys ?? [];
    const nameAddress = deriveNameAddress(this.programId, this.manifest.namespace, hash);
    const archOwnerAddress = deriveRecordAddressFor(
      this.programId,
      this.manifest.namespace,
      hash,
      "ArchOwner",
    );
    const taprootAddress = deriveRecordAddressFor(
      this.programId,
      this.manifest.namespace,
      hash,
      "BitcoinTaproot",
    );
    const textAddresses = textKeys.map((key) =>
      deriveRecordAddressFor(this.programId, this.manifest.namespace, hash, "Text", key),
    );
    const reverseAddress = options.primaryOwner
      ? deriveReverseAddress(this.programId, this.manifest.namespace, options.primaryOwner)
      : null;

    const addresses = [
      nameAddress,
      archOwnerAddress,
      taprootAddress,
      ...textAddresses,
      ...(reverseAddress ? [reverseAddress] : []),
    ];

    const accounts = this.transport.getMultipleAccounts
      ? await this.transport.getMultipleAccounts(addresses)
      : await Promise.all(addresses.map((address) => this.transport.readAccountInfo(address)));

    const nameRaw = accounts[0] ?? null;
    let nameAccount: NameAccount | null = null;
    if (nameRaw && nameRaw.data.length > 0) {
      if (!bytesEqual(nameRaw.owner, this.programId)) {
        throw new AnsError("IncorrectProgramId");
      }
      const decoded = decodeNameAccount(nameRaw.data);
      validateHeader(decoded.header, NAME_ACCOUNT_DISCRIMINATOR);
      nameAccount = decoded;
    }

    const decodeRecord = (raw: AccountInfo | null | undefined): RecordAccount | null => {
      if (!raw || raw.data.length === 0) return null;
      try {
        const decoded = decodeRecordAccount(raw.data);
        validateHeader(decoded.header, RECORD_ACCOUNT_DISCRIMINATOR);
        return decoded;
      } catch {
        return null;
      }
    };

    const archOwner = decodeRecord(accounts[1]);
    const taproot = decodeRecord(accounts[2]);
    const textByKey: Record<string, RecordAccount | null> = {};
    textKeys.forEach((key, index) => {
      textByKey[key] = decodeRecord(accounts[3 + index]);
    });

    let primaryName: string | null = null;
    if (options.primaryOwner && reverseAddress) {
      const reverseRaw = accounts[3 + textKeys.length] ?? null;
      if (reverseRaw && reverseRaw.data.length > 0) {
        try {
          const reverse = decodeReverseAccount(reverseRaw.data);
          validateHeader(reverse.header, REVERSE_ACCOUNT_DISCRIMINATOR);
          const primaryNameAddress = deriveNameAddress(
            this.programId,
            this.manifest.namespace,
            reverse.primaryNameHash,
          );
          // Same name we already loaded — avoid a second RPC when hashes match.
          let primaryNameRaw: AccountInfo | null =
            bytesEqual(primaryNameAddress, nameAddress) ? nameRaw : null;
          if (!primaryNameRaw) {
            primaryNameRaw = await this.transport.readAccountInfo(primaryNameAddress);
          }
          if (primaryNameRaw && primaryNameRaw.data.length > 0) {
            const config = await this.fetchRegistryConfig();
            const slot = await this.transport.getCurrentSlot();
            primaryName = resolvePrimary(
              this.programId,
              { address: this.registryConfigAddress, state: config },
              { address: reverseAddress, state: reverse },
              { address: primaryNameAddress, state: decodeNameAccount(primaryNameRaw.data) },
              slot,
            );
          }
        } catch (error) {
          if (!(error instanceof AnsError && error.code === "InvalidReverseBinding")) {
            throw error;
          }
          primaryName = null;
        }
      }
    }

    return { nameAccount, archOwner, taproot, textByKey, primaryName };
  }

  async resolveOwner(name: string): Promise<ArchAddress> {
    const config = await this.fetchRegistryConfig();
    const hash = nameHash(name);
    const address = deriveNameAddress(this.programId, this.manifest.namespace, hash);
    const account = await this.transport.readAccountInfo(address);
    if (!account) throw new AnsError("AccountNotFound", `name account for ${name}`);
    const slot = await this.transport.getCurrentSlot();
    return resolveOwner(
      this.programId,
      { address: this.registryConfigAddress, state: config },
      name,
      { address, state: decodeNameAccount(account.data) },
      slot,
    );
  }

  async resolveRecord(
    name: string,
    recordType: RecordType,
    textKey?: string,
  ): Promise<RecordValue> {
    const config = await this.fetchRegistryConfig();
    const hash = nameHash(name);
    const nameAddress = deriveNameAddress(this.programId, this.manifest.namespace, hash);
    const recordAddress = deriveRecordAddressFor(
      this.programId,
      this.manifest.namespace,
      hash,
      recordType,
      textKey,
    );
    const [nameAccount, recordAccount] = await Promise.all([
      this.transport.readAccountInfo(nameAddress),
      this.transport.readAccountInfo(recordAddress),
    ]);
    if (!nameAccount) throw new AnsError("AccountNotFound", `name account for ${name}`);
    if (!recordAccount) throw new AnsError("AccountNotFound", `record account for ${name}`);
    const slot = await this.transport.getCurrentSlot();
    return resolveRecord(
      this.programId,
      { address: this.registryConfigAddress, state: config },
      name,
      { address: nameAddress, state: decodeNameAccount(nameAccount.data) },
      { address: recordAddress, state: decodeRecordAccount(recordAccount.data) },
      recordType,
      slot,
      textKey,
    );
  }

  async resolvePrimary(owner: ArchAddress): Promise<string | null> {
    const config = await this.fetchRegistryConfig();
    const reverseAddress = deriveReverseAddress(
      this.programId,
      this.manifest.namespace,
      owner,
    );
    const reverseAccount = await this.transport.readAccountInfo(reverseAddress);
    if (!reverseAccount || reverseAccount.data.length === 0) return null;
    const reverse = decodeReverseAccount(reverseAccount.data);
    validateHeader(reverse.header, REVERSE_ACCOUNT_DISCRIMINATOR);
    const nameAddress = deriveNameAddress(
      this.programId,
      this.manifest.namespace,
      reverse.primaryNameHash,
    );
    const nameAccount = await this.transport.readAccountInfo(nameAddress);
    if (!nameAccount) return null;
    const slot = await this.transport.getCurrentSlot();
    try {
      return resolvePrimary(
        this.programId,
        { address: this.registryConfigAddress, state: config },
        { address: reverseAddress, state: reverse },
        { address: nameAddress, state: decodeNameAccount(nameAccount.data) },
        slot,
      );
    } catch (error) {
      if (error instanceof AnsError && error.code === "InvalidReverseBinding") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Every initialized name PDA owned by this program, after PDA/discriminator
   * checks. Shared by ownership and "recent registrations" scans.
   */
  async listNameAccounts(): Promise<Array<{ name: string; account: NameAccount }>> {
    if (!this.transport.getProgramAccounts) {
      throw new AnsError("CodecError", "transport does not support getProgramAccounts");
    }
    const entries = await this.transport.getProgramAccounts(this.programId, [
      { DataContent: { offset: 0, bytes: Array.from(NAME_ACCOUNT_DISCRIMINATOR) } },
    ]);
    const names: Array<{ name: string; account: NameAccount }> = [];
    for (const entry of entries) {
      if (!bytesEqual(entry.account.owner, this.programId)) continue;
      try {
        const account = decodeNameAccount(entry.account.data);
        validateHeader(account.header, NAME_ACCOUNT_DISCRIMINATOR);
        const name = canonicalizeName(`${account.canonicalLabel}.arch`);
        const expected = deriveNameAddress(
          this.programId,
          this.manifest.namespace,
          account.nameHash,
        );
        if (!bytesEqual(expected, entry.pubkey)) continue;
        names.push({ name, account });
      } catch {
        // Skip non-name or invalid accounts.
      }
    }
    return names;
  }

  async listOwnedNames(owner: ArchAddress): Promise<Array<{ name: string; account: NameAccount }>> {
    const names = await this.listNameAccounts();
    return names.filter((entry) => bytesEqual(entry.account.owner, owner));
  }

  /**
   * Newest registrations first, by on-chain `registeredAtSlot`.
   *
   * Fine for a small testnet front page. Full GPA from the browser will not
   * stay cheap forever — swap this for an indexer feed when the set grows.
   */
  async listRecentNames(
    limit = 12,
  ): Promise<Array<{ name: string; account: NameAccount }>> {
    return selectRecentNames(await this.listNameAccounts(), limit);
  }

  buildRegister(owner: ArchAddress, label: string): BuiltInstruction {
    return buildRegisterInstruction({
      programId: this.programId,
      owner,
      registryConfig: this.registryConfigAddress,
      namespace: this.manifest.namespace,
      label,
    });
  }

  buildTransfer(owner: ArchAddress, name: string, newOwner: ArchAddress): BuiltInstruction {
    return buildTransferInstruction({
      programId: this.programId,
      owner,
      registryConfig: this.registryConfigAddress,
      namespace: this.manifest.namespace,
      name,
      newOwner,
    });
  }

  buildListName(
    seller: ArchAddress,
    name: string,
    currency: QuoteCurrency,
    price: bigint,
  ): BuiltInstruction {
    return buildListNameInstruction({
      programId: this.programId,
      seller,
      registryConfig: this.registryConfigAddress,
      namespace: this.manifest.namespace,
      name,
      currency,
      price,
    });
  }

  buildCancelListing(seller: ArchAddress, name: string): BuiltInstruction {
    return buildCancelListingInstruction({
      programId: this.programId,
      seller,
      registryConfig: this.registryConfigAddress,
      namespace: this.manifest.namespace,
      name,
    });
  }

  buildBuyName(
    buyer: ArchAddress,
    seller: ArchAddress,
    name: string,
    currency: QuoteCurrency,
    tokenAccounts?: { buyerAta: ArchAddress; sellerAta: ArchAddress },
  ): BuiltInstruction {
    return buildBuyNameInstruction({
      programId: this.programId,
      buyer,
      seller,
      registryConfig: this.registryConfigAddress,
      namespace: this.manifest.namespace,
      name,
      currency,
      buyerAta: tokenAccounts?.buyerAta,
      sellerAta: tokenAccounts?.sellerAta,
    });
  }

  async fetchListing(name: string): Promise<ListingAccount | null> {
    const hash = nameHash(canonicalizeName(name));
    const address = deriveListingAddress(
      this.programId,
      this.manifest.namespace,
      hash,
    );
    const info = await this.transport.readAccountInfo(address);
    if (!info || info.data.length === 0) return null;
    try {
      const listing = decodeListingAccount(info.data);
      validateHeader(listing.header, LISTING_ACCOUNT_DISCRIMINATOR);
      if (!listing.active) return null;
      return listing;
    } catch {
      return null;
    }
  }

  async listActiveListings(): Promise<
    Array<{ name: string; listing: ListingAccount }>
  > {
    if (!this.transport.getProgramAccounts) {
      throw new AnsError("CodecError", "transport does not support getProgramAccounts");
    }
    const entries = await this.transport.getProgramAccounts(this.programId, [
      { DataContent: { offset: 0, bytes: Array.from(LISTING_ACCOUNT_DISCRIMINATOR) } },
    ]);
    const out: Array<{ name: string; listing: ListingAccount }> = [];
    const names = await this.listNameAccounts();
    const byHash = new Map(
      names.map((entry) => [bytesToHex(entry.account.nameHash), entry.name] as const),
    );
    for (const entry of entries) {
      if (!bytesEqual(entry.account.owner, this.programId)) continue;
      try {
        const listing = decodeListingAccount(entry.account.data);
        validateHeader(listing.header, LISTING_ACCOUNT_DISCRIMINATOR);
        if (!listing.active) continue;
        const expected = deriveListingAddress(
          this.programId,
          this.manifest.namespace,
          listing.nameHash,
        );
        if (!bytesEqual(expected, entry.pubkey)) continue;
        const name = byHash.get(bytesToHex(listing.nameHash));
        if (!name) continue;
        out.push({ name, listing });
      } catch {
        // skip
      }
    }
    return out;
  }

  buildSetRecord(
    owner: ArchAddress,
    name: string,
    recordType: RecordType,
    value: RecordValue,
    expectedRevision: bigint,
  ): BuiltInstruction {
    return buildSetRecordInstruction({
      programId: this.programId,
      owner,
      registryConfig: this.registryConfigAddress,
      namespace: this.manifest.namespace,
      name,
      recordType,
      value,
      expectedRevision,
    });
  }

  buildDeleteRecord(
    owner: ArchAddress,
    name: string,
    recordType: RecordType,
    expectedRevision: bigint,
    textKey?: string,
  ): BuiltInstruction {
    return buildDeleteRecordInstruction({
      programId: this.programId,
      owner,
      registryConfig: this.registryConfigAddress,
      namespace: this.manifest.namespace,
      name,
      recordType,
      textKey,
      expectedRevision,
    });
  }

  buildSetPrimary(owner: ArchAddress, name: string): BuiltInstruction {
    return buildSetPrimaryInstruction({
      programId: this.programId,
      owner,
      registryConfig: this.registryConfigAddress,
      namespace: this.manifest.namespace,
      name,
    });
  }

  buildClearPrimary(owner: ArchAddress): BuiltInstruction {
    return buildClearPrimaryInstruction({
      programId: this.programId,
      owner,
      namespace: this.manifest.namespace,
    });
  }

  async fetchRecord(
    name: string,
    recordType: RecordType,
    textKey?: string,
  ): Promise<RecordAccount | null> {
    const hash = nameHash(name);
    const address = deriveRecordAddressFor(
      this.programId,
      this.manifest.namespace,
      hash,
      recordType,
      textKey,
    );
    const account = await this.transport.readAccountInfo(address);
    if (!account || account.data.length === 0) return null;
    const decoded = decodeRecordAccount(account.data);
    validateHeader(decoded.header, RECORD_ACCOUNT_DISCRIMINATOR);
    return decoded;
  }

  async fetchReverse(owner: ArchAddress): Promise<ReverseAccount | null> {
    const address = deriveReverseAddress(
      this.programId,
      this.manifest.namespace,
      owner,
    );
    const account = await this.transport.readAccountInfo(address);
    if (!account || account.data.length === 0) return null;
    const decoded = decodeReverseAccount(account.data);
    validateHeader(decoded.header, REVERSE_ACCOUNT_DISCRIMINATOR);
    return decoded;
  }

  ownerHex(owner: ArchAddress): string {
    return bytesToHex(owner);
  }
}
