import { encodeInstruction } from "../codec/instruction.js";
import { SYSTEM_PROGRAM_ID } from "../constants.js";
import {
  deriveNameAddress,
  deriveRecordAddress,
  deriveReverseAddress,
} from "../derive.js";
import { nameHash } from "../name.js";
import type {
  ArchAddress,
  BuiltInstruction,
  RecordType,
  RecordValue,
} from "../types.js";

function meta(pubkey: ArchAddress, isSigner: boolean, isWritable: boolean) {
  return { pubkey, isSigner, isWritable };
}

export function buildRegisterInstruction(params: {
  programId: ArchAddress;
  owner: ArchAddress;
  registryConfig: ArchAddress;
  namespace: string;
  label: string;
  durationSlots?: bigint;
}): BuiltInstruction {
  const hash = nameHash(`${params.label}.arch`);
  const nameAccount = deriveNameAddress(params.programId, params.namespace, hash);
  return {
    programId: params.programId,
    accounts: [
      meta(params.owner, true, true),
      meta(params.registryConfig, false, false),
      meta(nameAccount, false, true),
      meta(SYSTEM_PROGRAM_ID, false, false),
    ],
    data: encodeInstruction({
      kind: "Register",
      label: params.label,
      durationSlots: params.durationSlots ?? 0n,
    }),
  };
}

export function buildTransferInstruction(params: {
  programId: ArchAddress;
  owner: ArchAddress;
  registryConfig: ArchAddress;
  namespace: string;
  name: string;
  newOwner: ArchAddress;
}): BuiltInstruction {
  const hash = nameHash(params.name);
  const nameAccount = deriveNameAddress(params.programId, params.namespace, hash);
  return {
    programId: params.programId,
    accounts: [
      meta(params.owner, true, true),
      meta(params.registryConfig, false, false),
      meta(nameAccount, false, true),
    ],
    data: encodeInstruction({
      kind: "Transfer",
      nameHash: hash,
      newOwner: params.newOwner,
    }),
  };
}

export function buildSetRecordInstruction(params: {
  programId: ArchAddress;
  owner: ArchAddress;
  registryConfig: ArchAddress;
  namespace: string;
  name: string;
  recordType: RecordType;
  value: RecordValue;
  expectedRevision: bigint;
}): BuiltInstruction {
  const hash = nameHash(params.name);
  const nameAccount = deriveNameAddress(params.programId, params.namespace, hash);
  const recordAccount = deriveRecordAddress(
    params.programId,
    params.namespace,
    hash,
    params.recordType,
  );
  return {
    programId: params.programId,
    accounts: [
      meta(params.owner, true, true),
      meta(params.registryConfig, false, false),
      meta(nameAccount, false, true),
      meta(recordAccount, false, true),
      meta(SYSTEM_PROGRAM_ID, false, false),
    ],
    data: encodeInstruction({
      kind: "SetRecord",
      nameHash: hash,
      recordType: params.recordType,
      value: params.value,
      expectedRevision: params.expectedRevision,
    }),
  };
}

export function buildSetPrimaryInstruction(params: {
  programId: ArchAddress;
  owner: ArchAddress;
  registryConfig: ArchAddress;
  namespace: string;
  name: string;
}): BuiltInstruction {
  const hash = nameHash(params.name);
  const nameAccount = deriveNameAddress(params.programId, params.namespace, hash);
  const reverseAccount = deriveReverseAddress(
    params.programId,
    params.namespace,
    params.owner,
  );
  return {
    programId: params.programId,
    accounts: [
      meta(params.owner, true, true),
      meta(params.registryConfig, false, false),
      meta(nameAccount, false, true),
      meta(reverseAccount, false, true),
      meta(SYSTEM_PROGRAM_ID, false, false),
    ],
    data: encodeInstruction({
      kind: "SetPrimary",
      nameHash: hash,
    }),
  };
}

export function buildClearPrimaryInstruction(params: {
  programId: ArchAddress;
  owner: ArchAddress;
  namespace: string;
}): BuiltInstruction {
  const reverseAccount = deriveReverseAddress(
    params.programId,
    params.namespace,
    params.owner,
  );
  return {
    programId: params.programId,
    accounts: [meta(params.owner, true, true), meta(reverseAccount, false, true)],
    data: encodeInstruction({ kind: "ClearPrimary" }),
  };
}
