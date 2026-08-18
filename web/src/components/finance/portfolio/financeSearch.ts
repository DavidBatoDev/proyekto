import type { StepKey } from "@/components/finance/ProjectContract";

export type FinanceTab = "overview" | "contracts" | "engagements" | "invoices";

export const FINANCE_TAB_IDS: FinanceTab[] = [
	"overview",
	"contracts",
	"engagements",
	"invoices",
];

/**
 * The whole page state lives in the URL, so every view a consultant reaches is
 * a link they can send to their accountant.
 */
export interface FinanceSearch {
	tab: FinanceTab;
	q?: string;
	projectId?: string;
	projectStatus?: string;
	currency?: string;
	from?: string;
	to?: string;
	contractStatus?: string;
	invoiceStatus?: string;
	step?: StepKey;
	/** 1-based, and omitted from the URL while it is 1. */
	page?: number;
}

export const CONTRACT_STEPS: StepKey[] = [
	"parties",
	"terms",
	"services",
	"agreement",
	"signatures",
];

export const FINANCE_PAGE_SIZE = 25;

function toFilterOption(value: string) {
	return {
		value,
		label: value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " "),
	};
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

/**
 * Which filter controls actually reach the query behind each tab.
 *
 * The bar used to render the same four facets everywhere while three of them
 * were dropped on the floor by the engagements tab, so picking a currency there
 * silently did nothing. Rendering from this map keeps the controls honest.
 */
export const TAB_FILTERS: Record<
	FinanceTab,
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
	engagements: {
		search: false,
		project: true,
		projectStatus: false,
		currency: false,
		date: false,
		contractStatus: false,
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
};

/** Count of filters that are both set AND meaningful on the current tab. */
export function activeFilterCount(search: FinanceSearch): number {
	const allowed = TAB_FILTERS[search.tab];
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
