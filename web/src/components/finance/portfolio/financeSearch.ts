import type { StepKey } from "@/components/finance/ProjectContract";

/**
 * Search-param vocabulary shared by the four finance section routes.
 *
 * The sections used to be `?tab=` values on one route, so a single validator
 * covered all of them. Now each section is its own route with its own
 * `validateSearch`, and these are the filters that survive moving between them:
 * narrowing to a project on Contracts and then opening Invoices should keep the
 * project selected rather than silently resetting it.
 *
 * Section-specific params (`contractStatus`, `invoiceStatus`) stay declared on
 * the one route that reads them, so they cannot leak into a URL where nothing
 * would apply them.
 */
export interface FinanceSharedSearch {
	q?: string;
	projectId?: string;
	projectStatus?: string;
	currency?: string;
	from?: string;
	to?: string;
}

export interface FinanceSearchState extends FinanceSharedSearch {
	contractStatus?: string;
	invoiceStatus?: string;
	step?: StepKey;
}

/**
 * Per-section search shapes.
 *
 * Every property is optional on purpose: the router derives a route's search
 * type from what `validateSearch` is declared to return, and a key typed
 * `string | undefined` is a REQUIRED key that happens to accept undefined. Left
 * inferred, `<Link to="/marketplace/finance">` would refuse to compile without
 * naming every filter — so each validator is annotated with one of these rather
 * than letting TypeScript infer the object literal.
 */
export interface FinanceOverviewSearch extends FinanceSharedSearch {
	/** Legacy only; `beforeLoad` forwards it and nothing renders from it. */
	tab?: string;
}

export interface FinanceContractsSearch extends FinanceSharedSearch {
	contractStatus?: string;
	step?: StepKey;
}

export interface FinanceInvoicesSearch extends FinanceSharedSearch {
	invoiceStatus?: string;
}

export interface ContractEditorSearch {
	section?: StepKey;
}

export const FINANCE_SECTIONS = [
	"overview",
	"contracts",
	"engagements",
	"invoices",
] as const;

export type FinanceSection = (typeof FINANCE_SECTIONS)[number];

export const CONTRACT_STEPS: StepKey[] = [
	"parties",
	"terms",
	"services",
	"agreement",
	"signatures",
];

export function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function validateFinanceSharedSearch(
	search: Record<string, unknown>,
): FinanceSharedSearch {
	return {
		q: stringValue(search.q),
		projectId: stringValue(search.projectId),
		projectStatus: stringValue(search.projectStatus),
		currency: stringValue(search.currency),
		from: stringValue(search.from),
		to: stringValue(search.to),
	};
}

export function validateContractStep(value: unknown): StepKey | undefined {
	return typeof value === "string" && CONTRACT_STEPS.includes(value as StepKey)
		? (value as StepKey)
		: undefined;
}

/**
 * Maps a legacy `?tab=` value onto the route that replaced it.
 *
 * `/marketplace/finance?tab=invoices&projectId=…` is still written by the
 * invoice scheduler's older notification rows and by anything a user has
 * bookmarked, and notification rows cannot be rewritten, so the overview route
 * forwards them rather than quietly rendering the wrong section. Returns
 * `undefined` for `overview` and for anything unrecognised — both belong on the
 * overview route, which is where the caller already is.
 */
export function legacyTabRoute(
	tab: unknown,
):
	| "/marketplace/finance/contracts"
	| "/marketplace/finance/engagements"
	| "/marketplace/finance/invoices"
	| undefined {
	switch (tab) {
		case "contracts":
			return "/marketplace/finance/contracts";
		case "engagements":
			return "/marketplace/finance/engagements";
		case "invoices":
			return "/marketplace/finance/invoices";
		default:
			return undefined;
	}
}

export const PROJECT_STATUS_OPTIONS = [
	"draft",
	"bidding",
	"active",
	"paused",
	"completed",
	"archived",
].map(toFilterOption);

export const CONTRACT_STATUS_OPTIONS = [
	"draft",
	"sent",
	"signed",
	"active",
	"ended",
	"cancelled",
].map(toFilterOption);

export const INVOICE_STATUS_OPTIONS = [
	"draft",
	"issued",
	"sent",
	"paid",
	"void",
].map(toFilterOption);

function toFilterOption(value: string) {
	return {
		value,
		label: value.charAt(0).toUpperCase() + value.slice(1),
	};
}

export function parseYmd(value?: string): Date | null {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const date = new Date(`${value}T00:00:00`);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function toIsoDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function formatDateRange(from?: string, to?: string): string {
	const formatDay = (value: string) =>
		new Intl.DateTimeFormat(undefined, {
			month: "short",
			day: "numeric",
		}).format(new Date(`${value}T00:00:00`));
	if (from && to) return `${formatDay(from)} – ${formatDay(to)}`;
	if (from) return `From ${formatDay(from)}`;
	if (to) return `Until ${formatDay(to)}`;
	return "Any date";
}

/**
 * Which section the router is currently showing.
 *
 * Derived from the pathname rather than passed down, so the layout does not
 * need a prop threaded through four route files that already know where they
 * are. Anything that is not one of the three named sections is the overview,
 * which is the layout's index route.
 */
export function financeSectionFromPathname(pathname: string): FinanceSection {
	if (pathname.startsWith("/marketplace/finance/contracts")) return "contracts";
	if (pathname.startsWith("/marketplace/finance/engagements")) {
		return "engagements";
	}
	if (pathname.startsWith("/marketplace/finance/invoices")) return "invoices";
	return "overview";
}
