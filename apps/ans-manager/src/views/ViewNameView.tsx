import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TEXT_RECORD_CATALOG, canonicalizeName } from "@arch-network/ans-sdk";
import { CopyValue } from "../components/CopyValue";
import { ExplorerLink } from "../components/ExplorerLink";
import { ReadOnlyRecordGroups } from "../components/ReadOnlyRecordGroups";
import { StatusNotice } from "../components/StatusNotice";
import { useArchWallet } from "../hooks/useArchWallet";
import { archAddressesEqual } from "../lib/ans";
import { loadNameProfile, type LoadedProfile } from "../lib/name-profile";
import {
  managePathForName,
  registerPathForLabel,
} from "../lib/register-handoff";

type ExtraRecord = { id: string; label: string; value: string };

function extrasFromProfile(profile: LoadedProfile): ExtraRecord[] {
  const extras: ExtraRecord[] = [];
  if (profile.taprootDisplay) {
    extras.push({
      id: "bitcoin-taproot",
      label: "Bitcoin Taproot",
      value: profile.taprootDisplay,
    });
  }
  for (const spec of TEXT_RECORD_CATALOG) {
    const value = profile.textByKey[spec.key]?.value;
    if (value) extras.push({ id: spec.key, label: spec.label, value });
  }
  return extras;
}

export function ViewNameView() {
  const { account } = useArchWallet();
  const [searchParams] = useSearchParams();
  const nameParam = searchParams.get("name");
  const [profile, setProfile] = useState<LoadedProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canonicalName = useMemo(() => {
    if (!nameParam?.trim()) return null;
    try {
      const raw = nameParam.trim().toLowerCase();
      return canonicalizeName(raw.includes(".") ? raw : `${raw}.arch`);
    } catch {
      return null;
    }
  }, [nameParam]);

  useEffect(() => {
    if (!canonicalName) {
      setProfile(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProfile(null);
    void loadNameProfile(canonicalName, account?.archAddress ?? null)
      .then(({ profile: next, error: loadError }) => {
        if (cancelled) return;
        if (loadError || !next) {
          setProfile(null);
          setError(loadError ?? `${canonicalName} is not registered.`);
          return;
        }
        setProfile(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canonicalName, account?.archAddress]);

  const extras = useMemo(
    () => (profile ? extrasFromProfile(profile) : []),
    [profile],
  );
  const ownedByViewer =
    !!profile?.ownerDisplay &&
    !!account?.archAddress &&
    archAddressesEqual(profile.ownerDisplay, account.archAddress);
  const available = !!canonicalName && !loading && !profile && !!error?.includes("not registered");

  return (
    <section className="page-section page-section-wide view-name-page">
      <div className="hero">
        <p className="eyebrow">Name lookup</p>
        <h1 className="page-title hero-title">
          {canonicalName ?? "View a name"}
        </h1>
        <p className="page-subtitle hero-copy">
          Read-only resolution from on-chain state. No wallet needed to look up a name.
        </p>
      </div>

      {!canonicalName ? (
        <StatusNotice
          tone="info"
          title="No name selected"
          message="Open a registered name from Discover, or search for one there."
          action={
            <Link className="btn btn-primary" to="/">
              Back to Discover
            </Link>
          }
        />
      ) : null}

      {loading ? <p className="view-name-status">Loading {canonicalName}…</p> : null}

      {available && canonicalName ? (
        <StatusNotice
          tone="success"
          title={`${canonicalName} is available`}
          message="Free on testnet. Yours permanently once you register."
          action={
            <Link className="btn btn-primary btn-full" to={registerPathForLabel(canonicalName)}>
              Register {canonicalName}
            </Link>
          }
        />
      ) : null}

      {error && !available ? (
        <StatusNotice
          tone="error"
          title="Could not load name"
          message="Try again in a moment, or search from Discover."
          detail={error}
        />
      ) : null}

      {profile && canonicalName ? (
        <div className="card view-name-card">
          <div className="view-name-header">
            <div>
              <p className="eyebrow">Registered</p>
              <h2 className="card-title mono">{canonicalName}</h2>
            </div>
            {ownedByViewer ? (
              <Link className="btn btn-primary" to={managePathForName(canonicalName)}>
                Manage
              </Link>
            ) : null}
          </div>

          <div className="view-name-owner">
            <span className="resolution-label">Owner</span>
            {profile.ownerDisplay ? (
              <div className="resolution-arch-value">
                <ExplorerLink
                  kind="account"
                  value={profile.ownerDisplay}
                  truncate={false}
                  className="record-value-link mono"
                />
                <CopyValue value={profile.ownerDisplay} />
              </div>
            ) : (
              <span className="record-empty">Unknown</span>
            )}
          </div>

          {profile.primaryName ? (
            <div className="view-name-owner">
              <span className="resolution-label">Primary for owner</span>
              <span className="mono">{profile.primaryName}</span>
            </div>
          ) : null}

          {extras.length > 0 ? (
            <div className="view-name-records">
              <h3 className="section-heading">Published records</h3>
              <ReadOnlyRecordGroups records={extras} />
            </div>
          ) : (
            <p className="view-name-status">No published records on this name yet.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
