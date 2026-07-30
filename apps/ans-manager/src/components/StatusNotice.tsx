import type { ReactNode } from "react";
import { ANS_BUILD } from "../lib/build-stamp";

type StatusNoticeProps = {
  tone: "error" | "warning" | "success" | "info";
  title: string;
  message?: string;
  metadata?: ReactNode;
  detail?: string;
  /** When set, controls whether technical details start expanded. Defaults to open for errors. */
  detailOpen?: boolean;
  action?: ReactNode;
};

export function StatusNotice({
  tone,
  title,
  message,
  metadata,
  detail,
  detailOpen,
  action,
}: StatusNoticeProps) {
  const openDetail = detailOpen ?? tone === "error";
  return (
    <div
      className={`notice notice-${tone === "info" ? "success" : tone}`}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      <div className="notice-body">
        <p className="notice-title">{title}</p>
        {message ? <p className="notice-message">{message}</p> : null}
        {metadata ? <p className="result-owner mono">{metadata}</p> : null}
        {detail ? (
          <details className="notice-detail" open={openDetail}>
            <summary>Technical details</summary>
            <code>{detail}</code>
            {/* Pinned to every report so a stale tab is never mistaken for a
                broken fix. */}
            <code>build {ANS_BUILD}</code>
          </details>
        ) : null}
        {action ? <div className="notice-action">{action}</div> : null}
      </div>
    </div>
  );
}
