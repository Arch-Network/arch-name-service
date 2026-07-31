import { encodeInstruction } from "../codec/instruction.js";
import {
  SYSTEM_PROGRAM_ID,
  TESTNET_ABTC_MINT,
  TOKEN_PROGRAM_ID,
} from "../constants.js";
import {
  deriveListingAddress,
  deriveNameAddress,
  deriveOfferAddress,
  deriveRecordAddressFor,
  deriveReverseAddress,
} from "../derive.js";
import { canonicalizeLabel, nameHash } from "../name.js";
import type {
  ArchAddress,
  BuiltInstruction,
  QuoteCurrency,
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
  // The encoded label must match the label the PDA was derived from, so both
  // come from one canonicalization pass.
  const label = canonicalizeLabel(params.label);
  const hash = nameHash(`${label}.arch`);
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
      label,
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
  const listingAccount = deriveListingAddress(params.programId, params.namespace, hash);
  return {
    programId: params.programId,
    accounts: [
      meta(params.owner, true, true),
      meta(params.registryConfig, false, false),
      meta(nameAccount, false, true),
      meta(listingAccount, false, false),
    ],
    data: encodeInstruction({
      kind: "Transfer",
      nameHash: hash,
      newOwner: params.newOwner,
    }),
  };
}

export function buildListNameInstruction(params: {
  programId: ArchAddress;
  seller: ArchAddress;
  registryConfig: ArchAddress;
  namespace: string;
  name: string;
  currency: QuoteCurrency;
  price: bigint;
}): BuiltInstruction {
  const hash = nameHash(params.name);
  const nameAccount = deriveNameAddress(params.programId, params.namespace, hash);
  const listingAccount = deriveListingAddress(params.programId, params.namespace, hash);
  return {
    programId: params.programId,
    accounts: [
      meta(params.seller, true, true),
      meta(params.registryConfig, false, false),
      meta(nameAccount, false, false),
      meta(listingAccount, false, true),
      meta(SYSTEM_PROGRAM_ID, false, false),
    ],
    data: encodeInstruction({
      kind: "ListName",
      nameHash: hash,
      currency: params.currency,
      price: params.price,
    }),
  };
}

export function buildCancelListingInstruction(params: {
  programId: ArchAddress;
  seller: ArchAddress;
  registryConfig: ArchAddress;
  namespace: string;
  name: string;
}): BuiltInstruction {
  const hash = nameHash(params.name);
  const nameAccount = deriveNameAddress(params.programId, params.namespace, hash);
  const listingAccount = deriveListingAddress(params.programId, params.namespace, hash);
  return {
    programId: params.programId,
    accounts: [
      meta(params.seller, true, true),
      meta(params.registryConfig, false, false),
      meta(nameAccount, false, false),
      meta(listingAccount, false, true),
    ],
    data: encodeInstruction({
      kind: "CancelListing",
      nameHash: hash,
    }),
  };
}

export function buildBuyNameInstruction(params: {
  programId: ArchAddress;
  buyer: ArchAddress;
  seller: ArchAddress;
  registryConfig: ArchAddress;
  namespace: string;
  name: string;
  currency: QuoteCurrency;
  buyerAta?: ArchAddress;
  sellerAta?: ArchAddress;
}): BuiltInstruction {
  const hash = nameHash(params.name);
  const nameAccount = deriveNameAddress(params.programId, params.namespace, hash);
  const listingAccount = deriveListingAddress(params.programId, params.namespace, hash);
  const accounts = [
    meta(params.buyer, true, true),
    meta(params.seller, false, true),
    meta(params.registryConfig, false, false),
    meta(nameAccount, false, true),
    meta(listingAccount, false, true),
  ];
  if (params.currency === "Btc") {
    if (!params.buyerAta || !params.sellerAta) {
      throw new Error("BTC purchases require buyer and seller aBTC ATAs");
    }
    accounts.push(
      meta(params.buyerAta, false, true),
      meta(params.sellerAta, false, true),
      meta(TESTNET_ABTC_MINT, false, false),
      meta(TOKEN_PROGRAM_ID, false, false),
    );
  }
  return {
    programId: params.programId,
    accounts,
    data: encodeInstruction({
      kind: "BuyName",
      nameHash: hash,
    }),
  };
}

export function buildMakeOfferInstruction(params: {
  programId: ArchAddress;
  buyer: ArchAddress;
  registryConfig: ArchAddress;
  namespace: string;
  name: string;
  currency: QuoteCurrency;
  price: bigint;
}): BuiltInstruction {
  const hash = nameHash(params.name);
  const nameAccount = deriveNameAddress(params.programId, params.namespace, hash);
  const offerAccount = deriveOfferAddress(
    params.programId,
    params.namespace,
    hash,
    params.buyer,
  );
  return {
    programId: params.programId,
    accounts: [
      meta(params.buyer, true, true),
      meta(params.registryConfig, false, false),
      meta(nameAccount, false, false),
      meta(offerAccount, false, true),
      meta(SYSTEM_PROGRAM_ID, false, false),
    ],
    data: encodeInstruction({
      kind: "MakeOffer",
      nameHash: hash,
      currency: params.currency,
      price: params.price,
    }),
  };
}

export function buildCancelOfferInstruction(params: {
  programId: ArchAddress;
  buyer: ArchAddress;
  registryConfig: ArchAddress;
  namespace: string;
  name: string;
}): BuiltInstruction {
  const hash = nameHash(params.name);
  const offerAccount = deriveOfferAddress(
    params.programId,
    params.namespace,
    hash,
    params.buyer,
  );
  return {
    programId: params.programId,
    accounts: [
      meta(params.buyer, true, true),
      meta(params.registryConfig, false, false),
      meta(offerAccount, false, true),
    ],
    data: encodeInstruction({
      kind: "CancelOffer",
      nameHash: hash,
    }),
  };
}

export function buildAcceptOfferInstruction(params: {
  programId: ArchAddress;
  seller: ArchAddress;
  buyer: ArchAddress;
  registryConfig: ArchAddress;
  namespace: string;
  name: string;
  currency: QuoteCurrency;
  buyerAta?: ArchAddress;
  sellerAta?: ArchAddress;
}): BuiltInstruction {
  const hash = nameHash(params.name);
  const nameAccount = deriveNameAddress(params.programId, params.namespace, hash);
  const offerAccount = deriveOfferAddress(
    params.programId,
    params.namespace,
    hash,
    params.buyer,
  );
  const listingAccount = deriveListingAddress(params.programId, params.namespace, hash);
  const buyerIsSigner = params.currency === "Btc";
  const accounts = [
    meta(params.seller, true, true),
    meta(params.buyer, buyerIsSigner, true),
    meta(params.registryConfig, false, false),
    meta(nameAccount, false, true),
    meta(offerAccount, false, true),
    meta(listingAccount, false, true),
  ];
  if (params.currency === "Btc") {
    if (!params.buyerAta || !params.sellerAta) {
      throw new Error("BTC offer accepts require buyer and seller aBTC ATAs");
    }
    accounts.push(
      meta(params.buyerAta, false, true),
      meta(params.sellerAta, false, true),
      meta(TESTNET_ABTC_MINT, false, false),
      meta(TOKEN_PROGRAM_ID, false, false),
    );
  }
  return {
    programId: params.programId,
    accounts,
    data: encodeInstruction({
      kind: "AcceptOffer",
      nameHash: hash,
      buyer: params.buyer,
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
  const textKey = params.value.kind === "Text" ? params.value.key : undefined;
  const recordAccount = deriveRecordAddressFor(
    params.programId,
    params.namespace,
    hash,
    params.recordType,
    textKey,
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

export function buildDeleteRecordInstruction(params: {
  programId: ArchAddress;
  owner: ArchAddress;
  registryConfig: ArchAddress;
  namespace: string;
  name: string;
  recordType: RecordType;
  textKey?: string;
  expectedRevision: bigint;
}): BuiltInstruction {
  const hash = nameHash(params.name);
  const nameAccount = deriveNameAddress(params.programId, params.namespace, hash);
  const recordAccount = deriveRecordAddressFor(
    params.programId,
    params.namespace,
    hash,
    params.recordType,
    params.textKey,
  );
  return {
    programId: params.programId,
    accounts: [
      meta(params.owner, true, true),
      meta(params.registryConfig, false, false),
      meta(nameAccount, false, false),
      meta(recordAccount, false, true),
    ],
    data: encodeInstruction({
      kind: "DeleteRecord",
      nameHash: hash,
      recordType: params.recordType,
      textKey: params.textKey ?? "",
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
