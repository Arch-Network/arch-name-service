import {
  TEXT_RECORD_CATALOG,
  loadTestnetManifest,
  manifestSupportsTextRecords,
  textRecordSpec,
  validateTextRecordInput,
  type TextRecordKey,
  type TextRecordSpec,
} from "@arch-network/ans-sdk";

export type RecordRowKind =
  | "arch-owner"
  | "primary"
  | "bitcoin-taproot"
  | "token-ata"
  | "text";

export type RecordGroupId = "priority" | "payments" | "web" | "profile" | "social";

export interface ProfileRecordRow {
  id: string;
  kind: RecordRowKind;
  label: string;
  monogram: string;
  description: string;
  group: RecordGroupId;
  placeholder?: string;
  textKey?: TextRecordKey;
  writable: boolean;
  gateReason: string | null;
  currentDisplay: string | null;
  published: boolean;
  revision: bigint;
}

const manifest = loadTestnetManifest();
export const liveTextRecordsEnabled = manifestSupportsTextRecords(manifest.features);
const tokenAtaEnabled = (manifest.tokenPrograms?.length ?? 0) > 0;

const TEXT_GROUPS: Record<TextRecordKey, RecordGroupId> = {
  eth: "payments",
  ltc: "payments",
  doge: "payments",
  bsc: "payments",
  inj: "payments",
  ipfs: "web",
  arwv: "web",
  ipns: "web",
  shdw: "web",
  point: "web",
  url: "web",
  email: "profile",
  pic: "profile",
  discord: "social",
  github: "social",
  reddit: "social",
  twitter: "social",
  telegram: "social",
};

const TEXT_MONOGRAMS: Record<TextRecordKey, string> = {
  eth: "Ξ",
  ltc: "Ł",
  doge: "Ð",
  bsc: "BNB",
  inj: "INJ",
  ipfs: "IPFS",
  arwv: "AR",
  ipns: "IPNS",
  shdw: "SH",
  point: "PT",
  url: "URL",
  email: "@",
  pic: "PIC",
  discord: "DC",
  github: "GH",
  reddit: "RD",
  twitter: "X",
  telegram: "TG",
};

export const RECORD_GROUPS: ReadonlyArray<{
  id: RecordGroupId;
  title: string;
  description: string;
  collapsible: boolean;
}> = [
  {
    id: "priority",
    title: "Arch identity",
    description: "Your primary Arch destination and reverse identity.",
    collapsible: false,
  },
  {
    id: "payments",
    title: "Payments",
    description: "Addresses people can use to pay this name.",
    collapsible: false,
  },
  {
    id: "web",
    title: "Web & content",
    description: "Connect your name to websites and decentralized content.",
    collapsible: true,
  },
  {
    id: "profile",
    title: "Profile",
    description: "Public contact and profile details.",
    collapsible: true,
  },
  {
    id: "social",
    title: "Social",
    description: "Public usernames linked to this identity.",
    collapsible: true,
  },
] as const;

export function buildProfileRows(params: {
  ownerDisplay: string | null;
  primaryName: string | null;
  canonicalName: string | null;
  archOwnerRevision: bigint;
  taprootDisplay: string | null;
  taprootRevision: bigint;
  textByKey: Record<string, { revision: bigint; value: string } | null>;
}): ProfileRecordRow[] {
  const rows: ProfileRecordRow[] = [
    {
      id: "arch-owner",
      kind: "arch-owner",
      label: "Arch destination",
      monogram: "A",
      description: "Default Arch account for this name.",
      group: "priority",
      writable: true,
      gateReason: null,
      currentDisplay: params.ownerDisplay,
      published: Boolean(params.ownerDisplay),
      revision: params.archOwnerRevision,
    },
    {
      id: "primary",
      kind: "primary",
      label: "Primary name",
      monogram: "★",
      description: "Reverse lookup identity for your wallet.",
      group: "priority",
      writable: true,
      gateReason: null,
      currentDisplay:
        params.primaryName &&
        params.canonicalName &&
        params.primaryName === params.canonicalName
          ? "This name is primary for the connected wallet"
          : params.primaryName
            ? `Wallet primary is ${params.primaryName}`
            : "Not set as primary",
      published: Boolean(
        params.primaryName &&
        params.canonicalName &&
        params.primaryName === params.canonicalName,
      ),
      revision: 0n,
    },
    {
      id: "bitcoin-taproot",
      kind: "bitcoin-taproot",
      label: "Bitcoin Taproot",
      monogram: "₿",
      description: "Bech32m Taproot payment address for this network.",
      group: "payments",
      placeholder: "tb1p…",
      writable: true,
      gateReason: null,
      currentDisplay: params.taprootDisplay,
      published: Boolean(params.taprootDisplay),
      revision: params.taprootRevision,
    },
  ];

  if (tokenAtaEnabled) {
    rows.push({
      id: "token-ata",
      kind: "token-ata",
      label: "Token receive account",
      monogram: "T",
      description: "Receive supported tokens through this name.",
      group: "payments",
      writable: true,
      gateReason: null,
      currentDisplay: null,
      published: false,
      revision: 0n,
    });
  }

  for (const spec of TEXT_RECORD_CATALOG) {
    const existing = params.textByKey[spec.key] ?? null;
    rows.push({
      id: `text:${spec.key}`,
      kind: "text",
      label: spec.label,
      monogram: TEXT_MONOGRAMS[spec.key],
      description: spec.description,
      group: TEXT_GROUPS[spec.key],
      placeholder: spec.placeholder,
      textKey: spec.key,
      writable: liveTextRecordsEnabled,
      gateReason: liveTextRecordsEnabled ? null : "Not available on this network yet",
      currentDisplay: existing?.value ?? null,
      published: Boolean(existing?.value),
      revision: existing?.revision ?? 0n,
    });
  }

  return rows;
}

export function groupProfileRows(rows: ProfileRecordRow[]): Array<{
  id: RecordGroupId;
  title: string;
  description: string;
  collapsible: boolean;
  publishedCount: number;
  rows: ProfileRecordRow[];
}> {
  return RECORD_GROUPS
    .map((group) => ({
      ...group,
      publishedCount: rows.filter(
        (row) => row.group === group.id && row.published,
      ).length,
      rows: rows.filter((row) => row.group === group.id),
    }))
    .filter((group) => group.rows.length > 0);
}

export function nextOpenEditor(
  currentId: string | null,
  requestedId: string,
): string | null {
  return currentId === requestedId ? null : requestedId;
}

export function validateDraft(row: ProfileRecordRow, draft: string): string | null {
  if (row.kind === "bitcoin-taproot") {
    if (!draft.trim()) return "Enter a Taproot address.";
    return null;
  }
  if (row.kind === "text" && row.textKey) {
    return validateTextRecordInput(row.textKey, draft);
  }
  return null;
}

export function textSpec(key: string): TextRecordSpec | undefined {
  return textRecordSpec(key);
}

export { TEXT_RECORD_CATALOG };
