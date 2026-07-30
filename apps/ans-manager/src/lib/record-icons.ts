import type { TextRecordKey } from "@arch-network/ans-sdk";

export type RecordIconKey =
  | "arch"
  | "bitcoin"
  | "ethereum"
  | "litecoin"
  | "dogecoin"
  | "bnbchain"
  | "ipfs"
  | "discord"
  | "github"
  | "reddit"
  | "x"
  | "telegram"
  | "star"
  | "coin"
  | "link"
  | "database"
  | "cloud"
  | "mail"
  | "image"
  | "social"
  | "wallet"
  | "fallback";

export type RecordIconSpec = {
  icon: RecordIconKey;
  badge?: string;
};

const TEXT_RECORD_ICONS: Record<TextRecordKey, RecordIconSpec> = {
  eth: { icon: "ethereum" },
  ltc: { icon: "litecoin" },
  doge: { icon: "dogecoin" },
  bsc: { icon: "bnbchain" },
  inj: { icon: "coin", badge: "INJ" },
  ipfs: { icon: "ipfs" },
  arwv: { icon: "database", badge: "AR" },
  ipns: { icon: "link", badge: "IPNS" },
  shdw: { icon: "cloud", badge: "SHDW" },
  point: { icon: "link", badge: "POINT" },
  url: { icon: "link" },
  email: { icon: "mail" },
  pic: { icon: "image" },
  discord: { icon: "discord" },
  github: { icon: "github" },
  reddit: { icon: "reddit" },
  twitter: { icon: "x" },
  telegram: { icon: "telegram" },
};

const BUILT_IN_RECORD_ICONS: Record<string, RecordIconSpec> = {
  "arch-owner": { icon: "arch" },
  primary: { icon: "star" },
  "bitcoin-taproot": { icon: "bitcoin" },
  "token-ata": { icon: "wallet" },
};

export function recordIconSpec(recordId: string): RecordIconSpec {
  const textKey = recordId.startsWith("text:") ? recordId.slice(5) : recordId;
  return (
    BUILT_IN_RECORD_ICONS[recordId] ??
    TEXT_RECORD_ICONS[textKey as TextRecordKey] ??
    { icon: "fallback" }
  );
}
