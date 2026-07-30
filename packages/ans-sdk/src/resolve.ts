import {
  NAME_ACCOUNT_DISCRIMINATOR,
  RECORD_ACCOUNT_DISCRIMINATOR,
  REGISTRY_CONFIG_DISCRIMINATOR,
  REVERSE_ACCOUNT_DISCRIMINATOR,
  validateHeader,
} from "./codec/state.js";
import {
  deriveConfigAddress,
  deriveNameAddress,
  deriveRecordAddressFor,
  deriveReverseAddress,
} from "./derive.js";
import { AnsError } from "./errors.js";
import { bytesEqual } from "./hex.js";
import { canonicalizeName, nameHash } from "./name.js";
import type {
  AccountAt,
  ArchAddress,
  NameAccount,
  RecordAccount,
  RecordType,
  RecordValue,
  RegistryConfig,
  ReverseAccount,
} from "./types.js";
import { isActive, validateRecordValue } from "./validate.js";

function validateConfig(
  programId: ArchAddress,
  config: AccountAt<RegistryConfig>,
): void {
  validateHeader(config.state.header, REGISTRY_CONFIG_DISCRIMINATOR);
  const expected = deriveConfigAddress(
    programId,
    config.state.networkId,
    config.state.namespace,
  );
  if (!bytesEqual(config.address, expected)) {
    throw new AnsError("InvalidAccountDerivation");
  }
}

function validateName(
  programId: ArchAddress,
  config: RegistryConfig,
  requestedName: string,
  name: AccountAt<NameAccount>,
  currentSlot: bigint,
): void {
  validateHeader(name.state.header, NAME_ACCOUNT_DISCRIMINATOR);
  const canonical = canonicalizeName(requestedName);
  const expectedHash = nameHash(canonical);
  const expectedAddress = deriveNameAddress(programId, config.namespace, expectedHash);
  if (!bytesEqual(name.address, expectedAddress)) {
    throw new AnsError("InvalidAccountDerivation");
  }
  if (!isActive(name.state, currentSlot)) {
    throw new AnsError("InactiveName");
  }
  if (
    !bytesEqual(name.state.nameHash, expectedHash) ||
    `${name.state.canonicalLabel}.arch` !== canonical
  ) {
    throw new AnsError("NameMismatch");
  }
}

export function resolveOwner(
  programId: ArchAddress,
  config: AccountAt<RegistryConfig>,
  requestedName: string,
  name: AccountAt<NameAccount>,
  currentSlot: bigint,
): ArchAddress {
  validateConfig(programId, config);
  validateName(programId, config.state, requestedName, name, currentSlot);
  return name.state.owner;
}

export function resolveRecord(
  programId: ArchAddress,
  config: AccountAt<RegistryConfig>,
  requestedName: string,
  name: AccountAt<NameAccount>,
  record: AccountAt<RecordAccount>,
  recordType: RecordType,
  currentSlot: bigint,
  textKey?: string,
): RecordValue {
  validateConfig(programId, config);
  validateName(programId, config.state, requestedName, name, currentSlot);
  validateHeader(record.state.header, RECORD_ACCOUNT_DISCRIMINATOR);
  const key =
    recordType === "Text"
      ? textKey ?? (record.state.value.kind === "Text" ? record.state.value.key : undefined)
      : undefined;
  const expected = deriveRecordAddressFor(
    programId,
    config.state.namespace,
    name.state.nameHash,
    recordType,
    key,
  );
  if (!bytesEqual(record.address, expected)) {
    throw new AnsError("InvalidAccountDerivation");
  }
  const state = record.state;
  if (
    !bytesEqual(state.nameHash, name.state.nameHash) ||
    state.recordType !== recordType ||
    !bytesEqual(state.ownerSnapshot, name.state.owner) ||
    state.recordEpoch !== name.state.recordEpoch
  ) {
    throw new AnsError("StaleRecord");
  }
  validateRecordValue(config.state, name.state, recordType, state.value);
  return state.value;
}

export function resolvePrimary(
  programId: ArchAddress,
  config: AccountAt<RegistryConfig>,
  reverse: AccountAt<ReverseAccount>,
  name: AccountAt<NameAccount>,
  currentSlot: bigint,
): string {
  validateConfig(programId, config);
  validateHeader(reverse.state.header, REVERSE_ACCOUNT_DISCRIMINATOR);
  const expectedReverse = deriveReverseAddress(
    programId,
    config.state.namespace,
    reverse.state.owner,
  );
  if (!bytesEqual(reverse.address, expectedReverse)) {
    throw new AnsError("InvalidAccountDerivation");
  }
  const expectedName = deriveNameAddress(
    programId,
    config.state.namespace,
    reverse.state.primaryNameHash,
  );
  if (!bytesEqual(name.address, expectedName)) {
    throw new AnsError("InvalidAccountDerivation");
  }
  validateHeader(name.state.header, NAME_ACCOUNT_DISCRIMINATOR);
  if (
    !isActive(name.state, currentSlot) ||
    !bytesEqual(name.state.nameHash, reverse.state.primaryNameHash) ||
    !bytesEqual(name.state.owner, reverse.state.owner) ||
    name.state.primaryBindingNonce !== reverse.state.bindingNonce
  ) {
    throw new AnsError("InvalidReverseBinding");
  }
  return canonicalizeName(`${name.state.canonicalLabel}.arch`);
}
