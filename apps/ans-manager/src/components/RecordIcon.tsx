import type { ReactNode } from "react";
import bitcoinIcon from "simple-icons/icons/bitcoin.svg";
import bnbChainIcon from "simple-icons/icons/bnbchain.svg";
import discordIcon from "simple-icons/icons/discord.svg";
import dogecoinIcon from "simple-icons/icons/dogecoin.svg";
import ethereumIcon from "simple-icons/icons/ethereum.svg";
import githubIcon from "simple-icons/icons/github.svg";
import ipfsIcon from "simple-icons/icons/ipfs.svg";
import litecoinIcon from "simple-icons/icons/litecoin.svg";
import redditIcon from "simple-icons/icons/reddit.svg";
import telegramIcon from "simple-icons/icons/telegram.svg";
import xIcon from "simple-icons/icons/x.svg";
import { recordIconSpec, type RecordIconKey } from "../lib/record-icons";

type RecordIconProps = {
  recordId: string;
  compact?: boolean;
};

const BRAND_ICONS: Partial<Record<RecordIconKey, string>> = {
  bitcoin: bitcoinIcon,
  ethereum: ethereumIcon,
  litecoin: litecoinIcon,
  dogecoin: dogecoinIcon,
  bnbchain: bnbChainIcon,
  ipfs: ipfsIcon,
  discord: discordIcon,
  github: githubIcon,
  reddit: redditIcon,
  x: xIcon,
  telegram: telegramIcon,
};

function LineIcon({ icon }: { icon: RecordIconKey }) {
  if (icon === "arch") {
    return <img src="/brand/arch-mark-orange.svg" alt="" />;
  }

  const brand = BRAND_ICONS[icon];
  if (brand) {
    return (
      <span
        className="record-brand-icon"
        style={{
          maskImage: `url("${brand}")`,
          WebkitMaskImage: `url("${brand}")`,
        }}
      />
    );
  }

  const paths: Partial<Record<RecordIconKey, ReactNode>> = {
    star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />,
    coin: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M9 9.5h4.2a2 2 0 0 1 0 4H9m3-6v9" />
      </>
    ),
    link: (
      <>
        <path d="m10 13.8 4-4" />
        <path d="M7.8 15.9 6.1 17.6a3 3 0 0 1-4.2-4.2l3.5-3.5a3 3 0 0 1 4.2 0" />
        <path d="m16.2 8.1 1.7-1.7a3 3 0 0 1 4.2 4.2l-3.5 3.5a3 3 0 0 1-4.2 0" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
      </>
    ),
    cloud: <path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6.2 8.5 4.8 4.8 0 0 0 7 18Z" />,
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="9" r="1.5" />
        <path d="m4 17 5-5 4 4 2-2 5 5" />
      </>
    ),
    social: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M6 20a6 6 0 0 1 12 0" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6.5h14a2 2 0 0 1 2 2V19H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h12" />
        <path d="M15 11h6v4h-6a2 2 0 0 1 0-4Z" />
      </>
    ),
    fallback: <circle cx="12" cy="12" r="4" />,
  };

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[icon] ?? paths.fallback}
    </svg>
  );
}

export function RecordIcon({ recordId, compact = false }: RecordIconProps) {
  const spec = recordIconSpec(recordId);
  return (
    <span className={`record-icon${compact ? " record-icon-compact" : ""}`} aria-hidden>
      <LineIcon icon={spec.icon} />
      {spec.badge ? <span className="record-icon-badge">{spec.badge}</span> : null}
    </span>
  );
}
