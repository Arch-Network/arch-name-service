import { CopyValue } from "./CopyValue";
import { ExplorerLink } from "./ExplorerLink";
import type { ProfileRecordRow } from "../lib/records";

function SummaryArchValue({ row }: { row: ProfileRecordRow | undefined }) {
  if (!row?.currentDisplay) {
    return <span className="record-empty">Not set</span>;
  }
  return (
    <div className="resolution-arch-value">
      <ExplorerLink
        kind="account"
        value={row.currentDisplay}
        truncate={false}
        className="record-value-link mono"
      />
      <CopyValue value={row.currentDisplay} />
    </div>
  );
}

export function ResolutionSummary({ rows }: { rows: ProfileRecordRow[] }) {
  const arch = rows.find((row) => row.kind === "arch-owner");
  const primary = rows.find((row) => row.kind === "primary");
  const highlights = rows
    .filter((row) => row.published && !["arch-owner", "primary"].includes(row.kind))
    .slice(0, 4);
  const publishedCount = rows.filter((row) => row.published && row.kind !== "primary").length;

  return (
    <div className="resolution-summary">
      <div className="resolution-summary-heading">
        <div>
          <p className="eyebrow">Resolution profile</p>
          <h2>This name resolves to</h2>
        </div>
        <span className="resolution-count">{publishedCount} published</span>
      </div>
      <div className="resolution-priority">
        <div>
          <span className="resolution-label">Arch destination</span>
          <SummaryArchValue row={arch} />
        </div>
        <div>
          <span className="resolution-label">Primary status</span>
          <span>{primary?.currentDisplay ?? "Not set as primary"}</span>
        </div>
      </div>
      {highlights.length > 0 ? (
        <div className="resolution-highlights" aria-label="Published record highlights">
          {highlights.map((row) => (
            <span key={row.id} className="resolution-highlight" title={row.currentDisplay ?? ""}>
              <span aria-hidden>{row.monogram}</span>
              {row.label}
            </span>
          ))}
        </div>
      ) : (
        <p className="resolution-empty">Add payment, web, profile, or social records below.</p>
      )}
    </div>
  );
}
