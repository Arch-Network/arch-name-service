import { useId } from "react";
import type { QuoteCurrency } from "@arch-network/ans-sdk";
import {
  formatQuoteBaseUnits,
  parseQuoteAmount,
  quoteBaseUnit,
  quoteSymbol,
  QUOTE_DECIMALS,
} from "../lib/quote-amount";
import type { QuoteBalance } from "../lib/quote-balance";

type QuoteAmountSelectorProps = {
  amount: string;
  currency: QuoteCurrency;
  label?: string;
  /** Omit to hide the balance row (listings do not escrow funds). */
  balance?: QuoteBalance | null;
  balanceLoading?: boolean;
  walletConnected?: boolean;
  onAmountChange: (amount: string) => void;
  onCurrencyChange: (currency: QuoteCurrency) => void;
};

export function QuoteAmountSelector({
  amount,
  currency,
  label = "Amount",
  balance,
  balanceLoading = false,
  walletConnected = false,
  onAmountChange,
  onCurrencyChange,
}: QuoteAmountSelectorProps) {
  const helpId = useId();
  const symbol = quoteSymbol(currency);
  const baseUnits = parseQuoteAmount(amount, currency);
  const tooPrecise =
    amount.includes(".") &&
    (amount.split(".")[1]?.length ?? 0) > QUOTE_DECIMALS[currency];
  const overBalance =
    !!balance && baseUnits !== null && baseUnits > balance.spendable;
  const showBalanceRow = balance !== undefined;

  return (
    <div className="quote-amount-selector">
      <div className="quote-amount-head">
        <div className="quote-currency-toggle" aria-label="Quote currency">
          {(["Arch", "Btc"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={
                currency === option
                  ? "quote-currency-option quote-currency-option-active"
                  : "quote-currency-option"
              }
              aria-pressed={currency === option}
              onClick={() => onCurrencyChange(option)}
            >
              {quoteSymbol(option)}
            </button>
          ))}
        </div>

        {showBalanceRow ? (
          <span className="quote-amount-balance">
            {!walletConnected ? (
              <span className="quote-amount-muted">No wallet</span>
            ) : balanceLoading || !balance ? (
              <span className="quote-amount-muted">Loading balance…</span>
            ) : (
              <>
                <span className="mono">
                  Bal {formatQuoteBaseUnits(balance.spendable, currency)} {symbol}
                </span>
                {balance.spendable > 0n ? (
                  <button
                    type="button"
                    className="quote-amount-max"
                    onClick={() =>
                      onAmountChange(
                        formatQuoteBaseUnits(balance.spendable, currency),
                      )
                    }
                  >
                    MAX
                  </button>
                ) : null}
              </>
            )}
          </span>
        ) : null}
      </div>

      <label className="field">
        <span className="field-label">{label}</span>
        <span className="quote-amount-input-wrap">
          <input
            className="input mono quote-amount-input"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder={currency === "Btc" ? "0.001" : "1.0"}
            value={amount}
            aria-invalid={tooPrecise || overBalance}
            aria-describedby={helpId}
            onChange={(event) => {
              const next = event.target.value.replace(/[^\d.]/g, "");
              if ((next.match(/\./g) ?? []).length <= 1) onAmountChange(next);
            }}
          />
          <span className="quote-amount-symbol">{symbol}</span>
        </span>
      </label>

      <p
        id={helpId}
        className={
          tooPrecise || overBalance
            ? "quote-amount-help quote-amount-error"
            : "quote-amount-help"
        }
      >
        {tooPrecise
          ? `${symbol} supports up to ${QUOTE_DECIMALS[currency]} decimals.`
          : overBalance
            ? `Not enough ${symbol}. You can offer up to ${formatQuoteBaseUnits(balance!.spendable, currency)} ${symbol}.`
            : baseUnits !== null && amount
              ? `${baseUnits.toLocaleString("en-US")} ${quoteBaseUnit(currency)} will be submitted on-chain.`
              : `Enter an amount in ${symbol}, not raw ${quoteBaseUnit(currency)}.`}
      </p>

      {showBalanceRow && balance && balance.reserved > 0n ? (
        <p className="quote-amount-note">
          {formatQuoteBaseUnits(balance.reserved, currency)} {symbol} is held back
          for the offer account rent and network fee.
        </p>
      ) : null}
      {currency === "Btc" ? (
        <p className="quote-amount-note">
          aBTC is Arch Bitcoin with 8 decimals; it is not a native Bitcoin UTXO.
        </p>
      ) : null}
    </div>
  );
}
