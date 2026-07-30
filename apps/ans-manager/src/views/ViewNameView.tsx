import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TEXT_RECORD_CATALOG,
  TESTNET_ABTC_MINT,
  TOKEN_PROGRAM_ID,
  canonicalizeName,
  deriveTokenAta,
  type ListingAccount,
} from "@arch-network/ans-sdk";
import { CopyValue } from "../components/CopyValue";
import { ExplorerLink } from "../components/ExplorerLink";
import { ReadOnlyRecordGroups } from "../components/ReadOnlyRecordGroups";
import { StatusNotice } from "../components/StatusNotice";
import { useArchWallet } from "../hooks/useArchWallet";
import {
  MANAGE_ACTIONS,
  ansClient,
  archAddressesEqual,
  decodeArchAddress,
  submitWithWindowArch,
} from "../lib/ans";
import { loadNameProfile, type LoadedProfile } from "../lib/name-profile";
import {
  managePathForName,
  registerPathForLabel,
} from "../lib/register-handoff";
import { nameOwnedBy } from "../lib/confirm-effects";
import { walletStatusCta } from "../lib/wallet-status";

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
  const { status, account, refresh, openWalletPicker } = useArchWallet();
  const [searchParams] = useSearchParams();
  const nameParam = searchParams.get("name");
  const [profile, setProfile] = useState<LoadedProfile | null>(null);
  const [listing, setListing] = useState<ListingAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buyBusy, setBuyBusy] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [buyTxid, setBuyTxid] = useState<string | null>(null);

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
      setListing(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProfile(null);
    setListing(null);
    void Promise.all([
      loadNameProfile(canonicalName, account?.archAddress ?? null),
      ansClient.fetchListing(canonicalName),
    ])
      .then(([{ profile: next, error: loadError }, nextListing]) => {
        if (cancelled) return;
        if (loadError || !next) {
          setProfile(null);
          setError(loadError ?? `${canonicalName} is not registered.`);
          return;
        }
        setProfile(next);
        setListing(nextListing);
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
  }, [canonicalName, account?.archAddress, buyTxid]);

  const extras = useMemo(
    () => (profile ? extrasFromProfile(profile) : []),
    [profile],
  );
  const ownedByViewer =
    !!profile?.ownerDisplay &&
    !!account?.archAddress &&
    archAddressesEqual(profile.ownerDisplay, account.archAddress);
  const available = !!canonicalName && !loading && !profile && !!error?.includes("not registered");
  const cta = walletStatusCta(status);
  const canBuy =
    !!listing &&
    !!profile?.ownerDisplay &&
    !!account?.archAddress &&
    !ownedByViewer &&
    !cta;

  async function onBuy() {
    if (!canonicalName || !listing || !profile?.ownerDisplay) return;
    setBuyBusy(true);
    setBuyError(null);
    setBuyTxid(null);
    try {
      const current = await refresh();
      if (current.state !== "connected") {
        openWalletPicker();
        return;
      }
      const buyer = decodeArchAddress(current.account.archAddress);
      const seller = decodeArchAddress(profile.ownerDisplay);
      const tokenAccounts =
        listing.currency === "Btc"
          ? {
              buyerAta: deriveTokenAta(
                buyer,
                TESTNET_ABTC_MINT,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
              ),
              sellerAta: deriveTokenAta(
                seller,
                TESTNET_ABTC_MINT,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
              ),
            }
          : undefined;
      const outcome = await submitWithWindowArch(
        async (actor) =>
          ansClient.buildBuyName(
            decodeArchAddress(actor),
            seller,
            canonicalName,
            listing.currency,
            tokenAccounts,
          ),
        undefined,
        nameOwnedBy(canonicalName, current.account.archAddress),
      );
      setBuyTxid(outcome.txid);
      setListing(null);
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuyBusy(false);
    }
  }

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
            ) : listing ? (
              <div className="view-name-buy">
                <p className="view-name-price mono">
                  {listing.price.toString()}{" "}
                  {listing.currency === "Btc" ? "aBTC sats" : "ARCH lamports"}
                </p>
                {cta ? (
                  <button className="btn btn-primary" type="button" onClick={openWalletPicker}>
                    Connect to buy
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={!canBuy || buyBusy}
                    onClick={() => void onBuy()}
                  >
                    {buyBusy ? "Buying…" : `Buy ${canonicalName}`}
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {buyTxid ? (
            <StatusNotice
              tone="success"
              title="Purchase submitted"
              message="Ownership should update once the transaction confirms."
              detail={buyTxid}
            />
          ) : null}
          {buyError ? (
            <StatusNotice tone="error" title={MANAGE_ACTIONS.buy} message={buyError} />
          ) : null}

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
