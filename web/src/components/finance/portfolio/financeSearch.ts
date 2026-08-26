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
	/** 1-based, and omitted from the URL while it is 1. */
	page?: number;
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
	page?: number;
}

export interface FinanceInvoicesSearch extends FinanceSharedSearch {
	invoiceStatus?: string;
	page?: number;
}

export interface ContractEditorSearch {
	section?: StepKey;
}

export const FINANCE_SECTIONS = [
	"overview",
	"contracts",
	"invoices",
	"imports",
] as const;

export type FinanceSection = (typeof FINANCE_SECTIONS)[number];

export const CONTRACT_STEPS: StepKey[] = [
	"parties",
	"terms",
	"services",
	"agreement",
	"signatures",
];

export const FINANCE_PAGE_SIZE = 25;

export function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Page 1 is the default, so it stays out of the URL rather than as `?page=1`. */
export function pageValue(value: unknown): number | undefined {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 1 ? parsed : undefined;
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
 * bookmarked, and notification rows cannot be rewritten, so the redirect stub
 * at the old overview URL forwards them rather than quietly rendering the
 * wrong section. Returns `undefined` for `overview` and for anything
 * unrecognised — both belong on the overview route.
 */
export function legacyTabRoute(
	tab: unknown,
):
	| "/engagements/finance/contracts"
	| "/engagements/finance/invoices"
	| undefined {
	switch (tab) {
		case "contracts":
			return "/engagements/finance/contracts";
		// `engagements` was a finance tab until the section moved to the
		// top-level `/engagements` page; the value falls through to the
		// overview, the closest thing finance still has.
		case "invoices":
			return "/engagements/finance/invoices";
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

// Mirrors CONTRACT_STATUSES in backend contracts.dto.ts. `active` is not a
// contract status there; listing it only ever produced an empty result.
export const CONTRACT_STATUS_OPTIONS = [
	"draft",
	"sent",
	"signed",
	"superseded",
	"ended",
	"cancelled",
].map(toFilterOption);

// Mirrors INVOICE_STATUSES in backend invoices.dto.ts. `sent` is not one of
// them — the old list offered a filter the API rejects.
export const INVOICE_STATUS_OPTIONS = [
	"draft",
	"issued",
	"partially_paid",
	"paid",
	"void",
].map(toFilterOption);

function toFilterOption(value: string) {
	return {
		value,
		label: value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " "),
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
/**
 * Which filter controls actually reach the query behind each section.
 *
 * The bar used to render the same four facets everywhere while some were
 * dropped on the floor by the section's query, so picking a currency could
 * silently do nothing. Rendering from this map keeps the controls honest.
 */
export const SECTION_FILTERS: Record<
	FinanceSection,
	{
		search: boolean;
		project: boolean;
		projectStatus: boolean;
		currency: boolean;
		date: boolean;
		contractStatus: boolean;
		invoiceStatus: boolean;
	}
> = {
	overview: {
		search: true,
		project: true,
		projectStatus: true,
		currency: true,
		date: true,
		contractStatus: false,
		invoiceStatus: false,
	},
	contracts: {
		search: true,
		project: true,
		projectStatus: true,
		currency: true,
		date: true,
		contractStatus: true,
		invoiceStatus: false,
	},
	invoices: {
		search: true,
		project: true,
		projectStatus: true,
		currency: true,
		date: true,
		contractStatus: false,
		invoiceStatus: true,
	},
	// Imports are filed under one project at a time — the workspace is scoped to
	// the project whose past billing is being recorded — so the project picker is
	// the only facet that changes what is on screen.
	imports: {
		search: false,
		project: true,
		projectStatus: false,
		currency: false,
		date: false,
		contractStatus: false,
		invoiceStatus: false,
	},
};

/** Count of filters that are both set AND meaningful in the current section. */
export function activeFilterCount(
	search: FinanceSearchState,
	section: FinanceSection,
): number {
	const allowed = SECTION_FILTERS[section];
	return [
		allowed.search ? search.q : undefined,
		allowed.project ? search.projectId : undefined,
		allowed.projectStatus ? search.projectStatus : undefined,
		allowed.currency ? search.currency : undefined,
		allowed.date ? search.from || search.to : undefined,
		allowed.contractStatus ? search.contractStatus : undefined,
		allowed.invoiceStatus ? search.invoiceStatus : undefined,
	].filter(Boolean).length;
}

export function financeSectionFromPathname(pathname: string): FinanceSection {
	if (pathname.startsWith("/engagements/finance/contracts")) return "contracts";
	if (pathname.startsWith("/engagements/finance/invoices")) return "invoices";
	if (pathname.startsWith("/engagements/finance/imports")) return "imports";
	return "overview";
}
