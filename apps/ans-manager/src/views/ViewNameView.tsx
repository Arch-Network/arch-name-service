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
  type OfferAccount,
  type QuoteCurrency,
} from "@arch-network/ans-sdk";
import { CopyValue } from "../components/CopyValue";
import { ExplorerLink } from "../components/ExplorerLink";
import { QuoteAmountSelector } from "../components/QuoteAmountSelector";
import { ReadOnlyRecordGroups } from "../components/ReadOnlyRecordGroups";
import { StatusNotice } from "../components/StatusNotice";
import { useArchWallet } from "../hooks/useArchWallet";
import {
  MANAGE_ACTIONS,
  ansClient,
  archAddressesEqual,
  decodeArchAddress,
  encodeArchAddress,
  submitWithWindowArch,
} from "../lib/ans";
import {
  formatQuoteAmount,
  labelLengthCategory,
  parseDomainProfileTab,
  sortOffersByPriceDesc,
  type DomainProfileTab,
} from "../lib/domain-profile";
import {
  fetchActivityForName,
  type NameActivityItem,
} from "../lib/name-activity";
import { loadNameProfile, type LoadedProfile } from "../lib/name-profile";
import {
  managePathForName,
  registerPathForLabel,
} from "../lib/register-handoff";
import { nameOwnedBy } from "../lib/confirm-effects";
import { formatQuoteBaseUnits, parseQuoteAmount, quoteSymbol } from "../lib/quote-amount";
import { fetchQuoteBalance, type QuoteBalance } from "../lib/quote-balance";
import { walletStatusCta } from "../lib/wallet-status";

type ExtraRecord = { id: string; label: string; value: string };

const CONTACT_KEYS = new Set(["email", "url", "twitter", "discord", "telegram"]);

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

function contactFromProfile(profile: LoadedProfile): ExtraRecord[] {
  return extrasFromProfile(profile).filter((row) => CONTACT_KEYS.has(row.id));
}

function addressRecords(extras: ExtraRecord[]): ExtraRecord[] {
  const addressKeys = new Set<string>(
    TEXT_RECORD_CATALOG.filter((s) => s.category === "crypto").map((s) => s.key),
  );
  addressKeys.add("bitcoin-taproot");
  return extras.filter((row) => addressKeys.has(row.id));
}

function otherRecords(extras: ExtraRecord[]): ExtraRecord[] {
  const address = new Set(addressRecords(extras).map((r) => r.id));
  const contact = CONTACT_KEYS;
  return extras.filter((row) => !address.has(row.id) && !contact.has(row.id));
}

function formatActivityTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ViewNameView() {
  const { status, account, refresh, openWalletPicker } = useArchWallet();
  const [searchParams, setSearchParams] = useSearchParams();
  const nameParam = searchParams.get("name");
  const tab = parseDomainProfileTab(searchParams.get("tab"));

  const [profile, setProfile] = useState<LoadedProfile | null>(null);
  const [listing, setListing] = useState<ListingAccount | null>(null);
  const [offers, setOffers] = useState<OfferAccount[]>([]);
  const [activity, setActivity] = useState<NameActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionTxid, setActionTxid] = useState<string | null>(null);
  /** Which action produced `actionTxid` / `actionError`, so feedback renders beside its button. */
  const [actionKind, setActionKind] = useState<string | null>(null);
  const [offerPrice, setOfferPrice] = useState("");
  const [offerCurrency, setOfferCurrency] = useState<QuoteCurrency>("Arch");
  const [balance, setBalance] = useState<QuoteBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
      setOffers([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProfile(null);
    setListing(null);
    setOffers([]);
    void Promise.all([
      loadNameProfile(canonicalName, account?.archAddress ?? null),
      ansClient.fetchListing(canonicalName),
      ansClient.listOffersForName(canonicalName).catch(() => [] as OfferAccount[]),
    ])
      .then(([{ profile: next, error: loadError }, nextListing, nextOffers]) => {
        if (cancelled) return;
        if (loadError || !next) {
          setProfile(null);
          setError(loadError ?? `${canonicalName} is not registered.`);
          return;
        }
        setProfile(next);
        setListing(nextListing);
        setOffers(sortOffersByPriceDesc(nextOffers));
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
  }, [canonicalName, account?.archAddress, refreshKey]);

  useEffect(() => {
    if (!canonicalName || tab !== "activity") {
      setActivity([]);
      setActivityError(null);
      return;
    }
    let cancelled = false;
    setActivityError(null);
    void fetchActivityForName(canonicalName)
      .then((rows) => {
        if (!cancelled) setActivity(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setActivity([]);
          setActivityError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canonicalName, tab, refreshKey]);

  useEffect(() => {
    const owner = account?.archAddress;
    if (!owner) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    setBalanceLoading(true);
    void fetchQuoteBalance(owner, offerCurrency)
      .then((next) => {
        if (!cancelled) setBalance(next);
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account?.archAddress, offerCurrency, refreshKey]);

  const extras = useMemo(
    () => (profile ? extrasFromProfile(profile) : []),
    [profile],
  );
  const contacts = useMemo(
    () => (profile ? contactFromProfile(profile) : []),
    [profile],
  );
  const ownedByViewer =
    !!profile?.ownerDisplay &&
    !!account?.archAddress &&
    archAddressesEqual(profile.ownerDisplay, account.archAddress);
  const available =
    !!canonicalName && !loading && !profile && !!error?.includes("not registered");
  const cta = walletStatusCta(status);
  const topOffer = offers[0] ?? null;
  const offerBaseUnits = parseQuoteAmount(offerPrice, offerCurrency);
  const offerExceedsBalance =
    !!balance && offerBaseUnits !== null && offerBaseUnits > balance.spendable;
  const offerAmountValid =
    offerBaseUnits !== null && offerBaseUnits > 0n && !offerExceedsBalance;
  const canBuy =
    !!listing &&
    !!profile?.ownerDisplay &&
    !!account?.archAddress &&
    !ownedByViewer &&
    !cta;

  function setTab(next: DomainProfileTab) {
    const params = new URLSearchParams(searchParams);
    if (next === "details") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  }

  async function withWalletActor(
    action: string,
    run: (actor: string) => Promise<{ txid: string }>,
  ) {
    setBusy(action);
    setActionKind(action);
    setActionError(null);
    setActionTxid(null);
    try {
      const current = await refresh();
      if (current.state !== "connected") {
        openWalletPicker();
        return;
      }
      const outcome = await run(current.account.archAddress);
      setActionTxid(outcome.txid);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function onBuy() {
    if (!canonicalName || !listing || !profile?.ownerDisplay) return;
    await withWalletActor(MANAGE_ACTIONS.buy, async (actor) => {
      const buyer = decodeArchAddress(actor);
      const seller = decodeArchAddress(profile.ownerDisplay!);
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
      return submitWithWindowArch(
        async () =>
          ansClient.buildBuyName(
            buyer,
            seller,
            canonicalName,
            listing.currency,
            tokenAccounts,
          ),
        undefined,
        nameOwnedBy(canonicalName, actor),
      );
    });
  }

  async function onMakeOffer() {
    if (!canonicalName) return;
    const price = parseQuoteAmount(offerPrice, offerCurrency);
    if (price === null || price <= 0n) {
      setActionKind(MANAGE_ACTIONS.makeOffer);
      setActionError(`Enter a valid positive ${quoteSymbol(offerCurrency)} amount.`);
      return;
    }
    if (balance && price > balance.spendable) {
      setActionKind(MANAGE_ACTIONS.makeOffer);
      setActionError(
        `Not enough ${quoteSymbol(offerCurrency)}. You can offer up to ${formatQuoteBaseUnits(balance.spendable, offerCurrency)} ${quoteSymbol(offerCurrency)}.`,
      );
      return;
    }
    await withWalletActor(MANAGE_ACTIONS.makeOffer, async (actor) =>
      submitWithWindowArch(
        async () =>
          ansClient.buildMakeOffer(
            decodeArchAddress(actor),
            canonicalName,
            offerCurrency,
            price,
          ),
      ),
    );
  }

  async function onCancelOffer() {
    if (!canonicalName) return;
    await withWalletActor(MANAGE_ACTIONS.cancelOffer, async (actor) =>
      submitWithWindowArch(async () =>
        ansClient.buildCancelOffer(decodeArchAddress(actor), canonicalName),
      ),
    );
  }

  async function onAcceptOffer(offer: OfferAccount) {
    if (!canonicalName || !profile?.ownerDisplay) return;
    if (offer.currency === "Btc") {
      setActionError(
        "aBTC offers need the buyer to co-sign Accept. Use an ARCH offer, or cancel and re-offer in ARCH.",
      );
      return;
    }
    await withWalletActor(MANAGE_ACTIONS.acceptOffer, async (actor) =>
      submitWithWindowArch(
        async () =>
          ansClient.buildAcceptOffer(
            decodeArchAddress(actor),
            offer.buyer,
            canonicalName,
            offer.currency,
          ),
        undefined,
        nameOwnedBy(canonicalName, encodeArchAddress(offer.buyer)),
      ),
    );
  }

  const label = canonicalName
    ? canonicalName.endsWith(".arch")
      ? canonicalName.slice(0, -".arch".length)
      : canonicalName
    : "";

  return (
    <section className="page-section page-section-wide view-name-page domain-profile">
      {!canonicalName ? (
        <StatusNotice
          tone="info"
          title="No name selected"
          message="Open a registered name from Discover or Marketplace."
          action={
            <Link className="btn btn-primary" to="/explore">
              Browse marketplace
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
        <>
          <div className="domain-profile-layout">
            <div className="domain-profile-main">
              <div className="domain-profile-hero">
                <p className="eyebrow">Domain profile</p>
                <h1 className="domain-profile-title mono">{canonicalName}</h1>
                <p className="domain-profile-art" aria-hidden="true">
                  {label.slice(0, 2).toUpperCase() || "·"}
                </p>
              </div>

              <dl className="domain-profile-meta">
                <div>
                  <dt>Seller</dt>
                  <dd>
                    {profile.ownerDisplay ? (
                      <div className="resolution-arch-value">
                        <ExplorerLink
                          kind="account"
                          value={profile.ownerDisplay}
                          truncate={{ head: 8, tail: 6 }}
                          className="record-value-link mono"
                        />
                        <CopyValue value={profile.ownerDisplay} />
                      </div>
                    ) : (
                      <span className="record-empty">Unknown</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Contact</dt>
                  <dd>
                    {contacts.length > 0 ? (
                      <ul className="domain-profile-contact-list">
                        {contacts.map((c) => (
                          <li key={c.id}>
                            <span className="domain-profile-contact-label">{c.label}</span>{" "}
                            <span className="mono">{c.value}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="record-empty">No contact records</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Description</dt>
                  <dd>
                    <span className="record-empty">
                      {canonicalName} · {labelLengthCategory(canonicalName)}
                    </span>
                  </dd>
                </div>
              </dl>

              <div className="domain-profile-tabs" role="tablist" aria-label="Domain sections">
                {(
                  [
                    ["details", "Details"],
                    ["offers", "Offers"],
                    ["activity", "Activity"],
                  ] as const
                ).map(([id, labelText]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    className={
                      tab === id
                        ? "domain-profile-tab domain-profile-tab-active"
                        : "domain-profile-tab"
                    }
                    onClick={() => setTab(id)}
                  >
                    {labelText}
                    {id === "offers" && offers.length > 0 ? (
                      <span className="domain-profile-tab-count">{offers.length}</span>
                    ) : null}
                  </button>
                ))}
              </div>

              <div className="domain-profile-panel" role="tabpanel">
                {tab === "details" ? (
                  <div className="domain-profile-details">
                    <div>
                      <h3 className="section-heading">Categories</h3>
                      <p className="domain-profile-chip">{labelLengthCategory(canonicalName)}</p>
                    </div>
                    <div>
                      <h3 className="section-heading">Addresses</h3>
                      {addressRecords(extras).length > 0 ? (
                        <ReadOnlyRecordGroups records={addressRecords(extras)} />
                      ) : (
                        <p className="view-name-status">No address records.</p>
                      )}
                    </div>
                    <div>
                      <h3 className="section-heading">Other records</h3>
                      {otherRecords(extras).length > 0 ? (
                        <ReadOnlyRecordGroups records={otherRecords(extras)} />
                      ) : (
                        <p className="view-name-status">No other records.</p>
                      )}
                    </div>
                    {ownedByViewer ? (
                      <Link className="btn btn-secondary" to={managePathForName(canonicalName)}>
                        Manage this name
                      </Link>
                    ) : null}
                  </div>
                ) : null}

                {tab === "offers" ? (
                  <div className="domain-profile-offers">
                    {!ownedByViewer ? (
                      <div className="domain-profile-offer-form">
                        <h3 className="section-heading">Make an offer</h3>
                        <QuoteAmountSelector
                          amount={offerPrice}
                          currency={offerCurrency}
                          label="Offer amount"
                          balance={balance}
                          balanceLoading={balanceLoading}
                          walletConnected={!!account?.archAddress}
                          onAmountChange={setOfferPrice}
                          onCurrencyChange={setOfferCurrency}
                        />
                        {cta ? (
                          <button
                            className="btn btn-primary"
                            type="button"
                            onClick={openWalletPicker}
                          >
                            Connect to offer
                          </button>
                        ) : (
                          <button
                            className="btn btn-primary"
                            type="button"
                            disabled={!!busy || !offerAmountValid}
                            onClick={() => void onMakeOffer()}
                          >
                            {busy === MANAGE_ACTIONS.makeOffer
                              ? "Submitting…"
                              : offerExceedsBalance
                                ? `Insufficient ${quoteSymbol(offerCurrency)}`
                                : "Make offer"}
                          </button>
                        )}
                        {actionKind === MANAGE_ACTIONS.makeOffer && actionTxid ? (
                          <StatusNotice
                            tone="success"
                            title="Offer submitted"
                            message="Your offer appears once the transaction confirms."
                            detail={actionTxid}
                          />
                        ) : null}
                        {actionKind === MANAGE_ACTIONS.makeOffer && actionError ? (
                          <StatusNotice
                            tone="error"
                            title="Offer failed"
                            message={actionError}
                          />
                        ) : null}
                      </div>
                    ) : null}

                    {offers.length === 0 ? (
                      <p className="view-name-status">No active offers yet.</p>
                    ) : (
                      <ul className="domain-profile-offer-list">
                        {offers.map((offer) => {
                          const buyerHex = encodeArchAddress(offer.buyer);
                          const isMine =
                            !!account?.archAddress &&
                            archAddressesEqual(buyerHex, account.archAddress);
                          return (
                            <li key={buyerHex} className="domain-profile-offer-row">
                              <div>
                                <p className="mono domain-profile-offer-price">
                                  {formatQuoteAmount(offer.price, offer.currency)}
                                </p>
                                <p className="view-name-status">
                                  From{" "}
                                  <ExplorerLink
                                    kind="account"
                                    value={buyerHex}
                                    truncate
                                    className="mono"
                                  />
                                </p>
                              </div>
                              <div className="domain-profile-offer-actions">
                                {isMine ? (
                                  <button
                                    className="btn btn-secondary"
                                    type="button"
                                    disabled={!!busy}
                                    onClick={() => void onCancelOffer()}
                                  >
                                    Cancel
                                  </button>
                                ) : null}
                                {ownedByViewer && offer.currency === "Arch" ? (
                                  <button
                                    className="btn btn-primary"
                                    type="button"
                                    disabled={!!busy}
                                    onClick={() => void onAcceptOffer(offer)}
                                  >
                                    Accept
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : null}

                {tab === "activity" ? (
                  <div className="domain-profile-activity">
                    {activityError ? (
                      <StatusNotice
                        tone="error"
                        title="Could not load activity"
                        message={activityError}
                      />
                    ) : null}
                    {!activityError && activity.length === 0 ? (
                      <p className="view-name-status">No indexed transactions yet.</p>
                    ) : null}
                    {activity.length > 0 ? (
                      <ul className="domain-profile-activity-list">
                        {activity.map((row) => (
                          <li key={row.txid} className="domain-profile-activity-row">
                            <span
                              className="domain-profile-activity-marker"
                              aria-hidden="true"
                            />
                            <div className="domain-profile-activity-event">
                              <span className="domain-profile-activity-title">
                                {row.action?.title ?? "Transaction"}
                                {row.failed ? (
                                  <span className="domain-profile-activity-failed">
                                    Failed
                                  </span>
                                ) : null}
                              </span>
                              {row.action?.detail ? (
                                <span className="domain-profile-activity-detail">
                                  {row.action.detail}
                                </span>
                              ) : null}
                            </div>
                            <div className="domain-profile-activity-meta">
                              <time className="domain-profile-activity-time">
                                {formatActivityTime(row.createdAt)}
                              </time>
                              <div className="domain-profile-activity-links">
                                {row.blockHeight != null ? (
                                  <span>
                                    Block {row.blockHeight.toLocaleString()}
                                  </span>
                                ) : null}
                                <ExplorerLink kind="tx" value={row.txid}>
                                  View transaction ↗
                                </ExplorerLink>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <aside className="domain-profile-aside">
              <div className="domain-profile-price-card">
                <p className="eyebrow">Price</p>
                {listing ? (
                  <>
                    <p className="domain-profile-list-price mono">
                      {formatQuoteAmount(listing.price, listing.currency)}
                    </p>
                    <p className="view-name-status">Buy now</p>
                  </>
                ) : (
                  <p className="domain-profile-list-price muted">Not listed</p>
                )}

                <div className="domain-profile-price-stats">
                  <div>
                    <span className="resolution-label">Top offer</span>
                    <p className="mono">
                      {topOffer
                        ? formatQuoteAmount(topOffer.price, topOffer.currency)
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <span className="resolution-label">Offers</span>
                    <p className="mono">{offers.length}</p>
                  </div>
                </div>

                {actionKind !== MANAGE_ACTIONS.makeOffer && actionTxid ? (
                  <StatusNotice
                    tone="success"
                    title="Submitted"
                    message="Refresh after confirmation."
                    detail={actionTxid}
                  />
                ) : null}
                {actionKind !== MANAGE_ACTIONS.makeOffer && actionError ? (
                  <StatusNotice tone="error" title="Action failed" message={actionError} />
                ) : null}

                <div className="domain-profile-aside-actions">
                  {ownedByViewer ? (
                    <Link className="btn btn-secondary btn-full" to={managePathForName(canonicalName)}>
                      Manage
                    </Link>
                  ) : null}
                  {!ownedByViewer ? (
                    <>
                      <button
                        className="btn btn-secondary btn-full"
                        type="button"
                        onClick={() => setTab("offers")}
                      >
                        Make offer
                      </button>
                      {listing ? (
                        cta ? (
                          <button
                            className="btn btn-primary btn-full"
                            type="button"
                            onClick={openWalletPicker}
                          >
                            Connect to buy
                          </button>
                        ) : (
                          <button
                            className="btn btn-primary btn-full"
                            type="button"
                            disabled={!canBuy || !!busy}
                            onClick={() => void onBuy()}
                          >
                            {busy === MANAGE_ACTIONS.buy ? "Buying…" : "Buy now"}
                          </button>
                        )
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </aside>
          </div>
        </>
      ) : null}
    </section>
  );
}
