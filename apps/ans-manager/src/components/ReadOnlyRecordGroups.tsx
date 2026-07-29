import { RecordIcon } from "./RecordIcon";

type ReadOnlyRecord = {
  id: string;
  label: string;
  value: string;
};

const GROUPS: ReadonlyArray<{
  id: string;
  title: string;
  keys: readonly string[];
}> = [
  {
    id: "payments",
    title: "Payments",
    keys: ["bitcoin-taproot", "eth", "ltc", "doge", "bsc", "inj"],
  },
  {
    id: "web",
    title: "Web & content",
    keys: ["url", "ipfs", "arwv", "ipns", "shdw", "point"],
  },
  { id: "profile", title: "Profile", keys: ["email", "pic"] },
  {
    id: "social",
    title: "Social",
    keys: ["discord", "github", "reddit", "twitter", "telegram"],
  },
];

export function ReadOnlyRecordGroups({ records }: { records: ReadOnlyRecord[] }) {
  return (
    <div className="readonly-record-groups">
      {GROUPS.map((group) => {
        const rows = records.filter((record) => group.keys.includes(record.id));
        if (rows.length === 0) return null;
        return (
          <section key={group.id} className="readonly-record-group">
            <h4>{group.title}</h4>
            <ul>
              {rows.map((row) => (
                <li key={row.id}>
                  <span className="readonly-record-label">
                    <RecordIcon recordId={row.id} compact />
                    <span>{row.label}</span>
                  </span>
                  <span className="mono" title={row.value}>{row.value}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
