import type { ReactNode } from "react";
import {
  explorerUrl,
  truncateMiddle,
  type ExplorerKind,
  type ExplorerNetwork,
} from "../lib/explorer";

type ExplorerLinkProps = {
  kind: ExplorerKind;
  value: string;
  network?: ExplorerNetwork;
  /** When true (default), show a middle-truncated label unless children are provided. */
  truncate?: boolean | { head?: number; tail?: number };
  className?: string;
  children?: ReactNode;
};

export function ExplorerLink({
  kind,
  value,
  network,
  truncate = true,
  className,
  children,
}: ExplorerLinkProps) {
  const href = explorerUrl({ kind, value, network });
  const head = typeof truncate === "object" ? (truncate.head ?? 6) : 6;
  const tail = typeof truncate === "object" ? (truncate.tail ?? 4) : 4;
  const label =
    children ?? (truncate ? truncateMiddle(value, head, tail) : value);
  const kindLabel = kind === "tx" ? "Transaction" : "Account";

  return (
    <a
      className={["explorer-link", className].filter(Boolean).join(" ")}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={value}
      aria-label={`${kindLabel} ${value}`}
    >
      {label}
    </a>
  );
}
