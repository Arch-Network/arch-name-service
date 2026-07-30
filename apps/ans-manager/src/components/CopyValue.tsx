import { useState } from "react";

type CopyValueProps = {
  value: string;
  className?: string;
  label?: string;
};

/** Compact copy control for full addresses / record values. */
export function CopyValue({ value, className, label = "Copy" }: CopyValueProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      className={["record-copy", className].filter(Boolean).join(" ")}
      onClick={() => void copy()}
      title="Copy full value"
      aria-label="Copy full value"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
