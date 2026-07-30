/**
 * SNS-parity text record catalog for ANS.
 *
 * Sources:
 * - https://docs.sns.id/dev/domain-records.md
 * - https://docs.sns.id/dev/on-chain-resolution.md
 *
 * Arch-native typed records (ArchOwner, BitcoinTaproot, TokenAta) are separate.
 * SOL maps to Arch owner / ArchOwner record. BTC maps to BitcoinTaproot (Taproot).
 * SNS NFT tokenization is intentionally out of scope.
 */

export type TextRecordCategory = "crypto" | "content" | "social" | "profile";

export type TextRecordKey =
  | "eth"
  | "ltc"
  | "doge"
  | "bsc"
  | "inj"
  | "ipfs"
  | "arwv"
  | "ipns"
  | "shdw"
  | "point"
  | "email"
  | "url"
  | "discord"
  | "github"
  | "reddit"
  | "twitter"
  | "telegram"
  | "pic";

export interface TextRecordSpec {
  key: TextRecordKey;
  label: string;
  category: TextRecordCategory;
  /** SNS record name as published in docs.sns.id */
  snsName: string;
  description: string;
  placeholder: string;
  /**
   * Client-side format check. On-chain only enforces key/value shape + length.
   * Returns an error message or null when valid.
   */
  validate?: (value: string) => string | null;
}

function ethAddressError(value: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return "Enter a 0x-prefixed 40-hex ETH address.";
  }
  return null;
}

function emailError(value: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
    return "Enter a valid email address.";
  }
  return null;
}

function urlError(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "URL must start with https:// or http://.";
    }
    return null;
  } catch {
    return "Enter a valid URL.";
  }
}

function nonEmptyHandle(label: string): (value: string) => string | null {
  return (value) => {
    const trimmed = value.trim();
    if (!trimmed || /\s/.test(trimmed) || trimmed.length > 64) {
      return `Enter a valid ${label}.`;
    }
    return null;
  };
}

/** Full SNS-parity TEXT catalog ANS aims to publish (user-facing). */
export const TEXT_RECORD_CATALOG: readonly TextRecordSpec[] = [
  {
    key: "eth",
    label: "Ethereum",
    category: "crypto",
    snsName: "ETH",
    description: "EVM payment address",
    placeholder: "0x…",
    validate: ethAddressError,
  },
  {
    key: "ltc",
    label: "Litecoin",
    category: "crypto",
    snsName: "LTC",
    description: "Litecoin address",
    placeholder: "ltc1… or L…",
  },
  {
    key: "doge",
    label: "Dogecoin",
    category: "crypto",
    snsName: "DOGE",
    description: "Dogecoin address",
    placeholder: "D…",
  },
  {
    key: "bsc",
    label: "BNB Smart Chain",
    category: "crypto",
    snsName: "BSC",
    description: "BSC / EVM address",
    placeholder: "0x…",
    validate: ethAddressError,
  },
  {
    key: "inj",
    label: "Injective",
    category: "crypto",
    snsName: "INJ",
    description: "Injective / Cosmos bech32 address",
    placeholder: "inj1…",
  },
  {
    key: "ipfs",
    label: "IPFS",
    category: "content",
    snsName: "IPFS",
    description: "IPFS content identifier",
    placeholder: "ipfs://… or CID",
  },
  {
    key: "arwv",
    label: "Arweave",
    category: "content",
    snsName: "ARWV",
    description: "Arweave transaction / address",
    placeholder: "ar://…",
  },
  {
    key: "ipns",
    label: "IPNS",
    category: "content",
    snsName: "IPNS",
    description: "IPNS name",
    placeholder: "ipns://…",
  },
  {
    key: "shdw",
    label: "Shadow Drive",
    category: "content",
    snsName: "SHDW",
    description: "Shadow Drive address",
    placeholder: "Shadow Drive URI",
  },
  {
    key: "point",
    label: "Point Network",
    category: "content",
    snsName: "POINT",
    description: "Point Network record",
    placeholder: "Point record",
  },
  {
    key: "url",
    label: "Website",
    category: "profile",
    snsName: "url",
    description: "Website URL",
    placeholder: "https://…",
    validate: urlError,
  },
  {
    key: "email",
    label: "Email",
    category: "profile",
    snsName: "email",
    description: "Contact email",
    placeholder: "you@example.com",
    validate: emailError,
  },
  {
    key: "pic",
    label: "Profile picture",
    category: "profile",
    snsName: "pic",
    description: "Profile image URL or CID",
    placeholder: "https://… or ipfs://…",
  },
  {
    key: "discord",
    label: "Discord",
    category: "social",
    snsName: "discord",
    description: "Discord username",
    placeholder: "username",
    validate: nonEmptyHandle("Discord username"),
  },
  {
    key: "twitter",
    label: "X / Twitter",
    category: "social",
    snsName: "twitter",
    description: "X / Twitter handle",
    placeholder: "@handle",
    validate: nonEmptyHandle("Twitter handle"),
  },
  {
    key: "github",
    label: "GitHub",
    category: "social",
    snsName: "github",
    description: "GitHub username",
    placeholder: "username",
    validate: nonEmptyHandle("GitHub username"),
  },
  {
    key: "reddit",
    label: "Reddit",
    category: "social",
    snsName: "reddit",
    description: "Reddit username",
    placeholder: "u/username",
    validate: nonEmptyHandle("Reddit username"),
  },
  {
    key: "telegram",
    label: "Telegram",
    category: "social",
    snsName: "telegram",
    description: "Telegram username",
    placeholder: "@username",
    validate: nonEmptyHandle("Telegram username"),
  },
] as const;

export function textRecordSpec(key: string): TextRecordSpec | undefined {
  return TEXT_RECORD_CATALOG.find((row) => row.key === key);
}

export function validateTextRecordInput(key: string, value: string): string | null {
  const spec = textRecordSpec(key);
  if (!spec) return "Unknown record type.";
  const trimmed = value.trim();
  if (!trimmed) return "Enter a value.";
  if (spec.validate) return spec.validate(trimmed);
  if (trimmed.length > 256) return "Value is too long.";
  return null;
}

/** Whether the deployment manifesto enables on-chain Text records. */
export function manifestSupportsTextRecords(features?: { textRecords?: boolean }): boolean {
  return features?.textRecords === true;
}
