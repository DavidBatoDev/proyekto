/**
 * Shared currency list + a canonical formatter.
 *
 * The codebase historically grew two `formatMoney` helpers with REVERSED
 * argument order and different output — `time-utils.ts` (`(amount, currency)`,
 * Intl currency style) and `contract-term.ts` (`(currency, amount)`, "USD 1,200.00"
 * string). Both are load-bearing at many call sites, and silently swapping
 * either would mis-render every amount. So this module does NOT replace them; it
 * adds the one thing that was missing everywhere — a single source of truth for
 * the selectable currency list — plus a clearly-named formatter for NEW code
 * that has no reason to prefer one legacy style.
 */

export interface CurrencyOption {
	code: string;
	label: string;
}

/**
 * The currencies offered in dropdowns. Superset of the team-settings trio
 * (USD/CAD/PHP) and the old inline list in CommercialTermsCard. `projects.currency`
 * / `contracts.currency` / `team_member_rates.currency` are unconstrained in the
 * DB, so this list — not a CHECK — governs what the UI offers.
 */
export const CURRENCIES: CurrencyOption[] = [
	{ code: "USD", label: "USD — US Dollar" },
	{ code: "PHP", label: "PHP — Philippine Peso" },
	{ code: "EUR", label: "EUR — Euro" },
	{ code: "GBP", label: "GBP — British Pound" },
	{ code: "AUD", label: "AUD — Australian Dollar" },
	{ code: "SGD", label: "SGD — Singapore Dollar" },
	{ code: "CAD", label: "CAD — Canadian Dollar" },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export const DEFAULT_CURRENCY = "USD";

/** Bare currency codes, for `<option>` lists that show the code only. */
export const CURRENCY_CODE_OPTIONS = CURRENCIES.map((c) => c.code);

/**
 * Canonical amount formatter for new code: `"PHP 1,200.00"`. Matches the
 * `contract-term.ts` output style (readable across currencies whether or not the
 * runtime has a symbol for them), but takes arguments in the natural
 * `(amount, currency)` order.
 */
export function formatCurrency(
	amount: number | null | undefined,
	currency: string,
): string {
	const value = Number(amount ?? 0);
	return `${(currency || DEFAULT_CURRENCY).toUpperCase()} ${value.toLocaleString(
		undefined,
		{ minimumFractionDigits: 2, maximumFractionDigits: 2 },
	)}`;
}
