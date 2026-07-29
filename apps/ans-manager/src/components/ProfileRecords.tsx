import { useEffect, useRef, useState } from "react";
import { CopyValue } from "./CopyValue";
import { ExplorerLink } from "./ExplorerLink";
import { RecordIcon } from "./RecordIcon";
import {
  nextOpenEditor,
  validateDraft,
  type ProfileRecordRow,
  type RecordGroupId,
} from "../lib/records";

type RecordGroup = {
  id: RecordGroupId;
  title: string;
  description: string;
  collapsible: boolean;
  publishedCount: number;
  rows: ProfileRecordRow[];
};

type ProfileRecordsProps = {
  groups: RecordGroup[];
  drafts: Record<string, string>;
  busy: boolean;
  busyAction: string | null;
  ready: boolean;
  onDraftChange: (id: string, value: string) => void;
  onSave: (row: ProfileRecordRow) => void;
  onSetPrimary: () => void;
  onClearPrimary: () => void;
  onUseConnectedWallet: (row: ProfileRecordRow) => void;
};

function RecordValue({ row }: { row: ProfileRecordRow }) {
  if (!row.currentDisplay) {
    return <span className="record-empty">Not set</span>;
  }
  if (row.kind === "arch-owner") {
    return (
      <ExplorerLink
        kind="account"
        value={row.currentDisplay}
        truncate={false}
        className="record-value-link mono"
      />
    );
  }
  return (
    <span className="record-current mono" title={row.currentDisplay}>
      {row.currentDisplay}
    </span>
  );
}

function RecordEditor({
  row,
  draft,
  busy,
  ready,
  onDraftChange,
  onCancel,
  onSave,
}: {
  row: ProfileRecordRow;
  draft: string;
  busy: boolean;
  ready: boolean;
  onDraftChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const validation = draft.trim() ? validateDraft(row, draft) : null;
  const invalid = Boolean(validation);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="record-editor">
      <label className="input-label" htmlFor={`record-${row.id}`}>
        {row.label} value
      </label>
      <input
        ref={inputRef}
        id={`record-${row.id}`}
        className="input mono"
        placeholder={row.placeholder}
        value={draft}
        disabled={busy}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        autoComplete="off"
        aria-invalid={invalid}
        aria-describedby={`record-${row.id}-help`}
      />
      <p
        id={`record-${row.id}-help`}
        className={`field-help${invalid ? " record-validation" : ""}`}
      >
        {validation ?? row.description}
      </p>
      <div className="record-editor-actions">
        <button type="button" className="btn btn-secondary btn-small" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={busy || !ready || !draft.trim() || invalid}
          onClick={onSave}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function RecordRow({
  row,
  draft,
  open,
  busy,
  saving,
  ready,
  onToggle,
  onDraftChange,
  onSave,
  onSetPrimary,
  onClearPrimary,
  onUseConnectedWallet,
}: {
  row: ProfileRecordRow;
  draft: string;
  open: boolean;
  busy: boolean;
  saving: boolean;
  ready: boolean;
  onToggle: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onSetPrimary: () => void;
  onClearPrimary: () => void;
  onUseConnectedWallet: () => void;
}) {
  const editable = row.kind === "bitcoin-taproot" || row.kind === "text";
  const primarySet = row.kind === "primary" && row.published;

  return (
    <div className={`profile-record${open ? " profile-record-open" : ""}`}>
      <div className="profile-record-main">
        <RecordIcon recordId={row.textKey ?? row.id} />
        <div className="profile-record-copy">
          <div className="profile-record-title">
            <h4>{row.label}</h4>
            {saving || row.published ? (
              <span className={`record-state${saving ? " record-state-saving" : ""}`}>
                {saving ? "Saving" : "Published"}
              </span>
            ) : null}
          </div>
          <div className="profile-record-value">
            <RecordValue row={row} />
            {row.currentDisplay && row.kind !== "primary" ? (
              <CopyValue value={row.currentDisplay} />
            ) : null}
          </div>
        </div>
        <div className="profile-record-action">
          {editable ? (
            <button
              type="button"
              className="record-edit-button"
              onClick={onToggle}
              aria-expanded={open}
              aria-controls={`record-editor-${row.id}`}
              disabled={busy || !row.writable}
            >
              {open ? "Close" : row.published ? "Edit" : "Add"}
            </button>
          ) : null}
          {row.kind === "arch-owner" ? (
            <button
              type="button"
              className="record-edit-button"
              disabled={busy || !ready || !row.writable}
              onClick={onUseConnectedWallet}
            >
              Update
            </button>
          ) : null}
        </div>
      </div>
      {row.kind === "primary" ? (
        <div className="primary-record-actions">
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={busy || !ready || primarySet}
            onClick={onSetPrimary}
          >
            Set as primary
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={busy || !ready || !primarySet}
            onClick={onClearPrimary}
          >
            Clear primary
          </button>
        </div>
      ) : null}
      {open ? (
        <div id={`record-editor-${row.id}`}>
          <RecordEditor
            row={row}
            draft={draft}
            busy={busy}
            ready={ready}
            onDraftChange={onDraftChange}
            onCancel={onToggle}
            onSave={onSave}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ProfileRecords({
  groups,
  drafts,
  busy,
  busyAction,
  ready,
  onDraftChange,
  onSave,
  onSetPrimary,
  onClearPrimary,
  onUseConnectedWallet,
}: ProfileRecordsProps) {
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState(() => new Set<RecordGroupId>(["web"]));

  return (
    <div className="profile-record-sections">
      {groups.map((group) => {
        const content = (
          <div className="profile-record-list">
            {group.rows.map((row) => (
              <RecordRow
                key={row.id}
                row={row}
                draft={drafts[row.id] ?? ""}
                open={openRowId === row.id}
                busy={busy}
                saving={Boolean(
                  busyAction &&
                  (busyAction.includes(row.label) ||
                    (row.kind === "arch-owner" && busyAction.includes("Arch wallet")) ||
                    (row.kind === "primary" && busyAction.toLowerCase().includes("primary"))),
                )}
                ready={ready}
                onToggle={() => setOpenRowId((current) => nextOpenEditor(current, row.id))}
                onDraftChange={(value) => onDraftChange(row.id, value)}
                onSave={() => onSave(row)}
                onSetPrimary={onSetPrimary}
                onClearPrimary={onClearPrimary}
                onUseConnectedWallet={() => onUseConnectedWallet(row)}
              />
            ))}
          </div>
        );
        const heading = (
          <div className="record-section-heading">
            <div>
              <h3>{group.title}</h3>
              <p>{group.description}</p>
            </div>
            <span>{group.publishedCount} of {group.rows.length} set</span>
          </div>
        );

        return group.collapsible ? (
          <details
            key={group.id}
            className="record-section"
            open={openGroups.has(group.id)}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setOpenGroups((current) => {
                if (current.has(group.id) === open) return current;
                const next = new Set(current);
                if (open) next.add(group.id);
                else next.delete(group.id);
                return next;
              });
            }}
          >
            <summary>{heading}</summary>
            {content}
          </details>
        ) : (
          <section key={group.id} className="record-section">
            {heading}
            {content}
          </section>
        );
      })}
    </div>
  );
}
