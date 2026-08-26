import {
	BarChart3,
	CircleDollarSign,
	FileSignature,
	Handshake,
	type LucideIcon,
	ReceiptText,
} from "lucide-react";

/**
 * Navigation for the engagements shell at `/engagements`.
 *
 * Mirrors `marketplaceNavigation.ts` (icon on the item, one-file change to add
 * an entry). It started as finance-only, when finance had its own shell nested
 * under engagements and the list page rendered bare; the shell now wraps the
 * whole `/engagements` subtree, so the engagement list is a first-class
 * destination here rather than a back-link out.
 *
 * Sections, not pages within them. Finance is one entry even though it holds
 * three surfaces, because Overview / Contracts / Invoices are tabs on the
 * finance page itself — listing them here too would give every one of them two
 * places to be selected from. The engagement list's seat tabs and status
 * filter are absent for the same reason.
 *
 * Finance stays a consultant capability, while the engagements entry and the
 * teams nested under finance (appended at render time from the caller's
 * administered teams) are deliberately NOT gated: every seat on an engagement
 * may read its own agreements, and a project admin runs team finance without
 * ever being a marketplace consultant.
 */
export interface EngagementsNavItem {
	key: string;
	to: string;
	label: string;
	icon: LucideIcon;
	match: "exact" | "prefix";
	requires?: "consultant";
	/**
	 * Path prefixes this item must NOT light on, so a parent path can use
	 * `prefix` matching without claiming a nested section as its own.
	 */
	excludes?: string[];
}

export const ENGAGEMENTS_NAV_ITEMS: EngagementsNavItem[] = [
	{
		key: "engagements",
		to: "/engagements",
		label: "All engagements",
		icon: Handshake,
		match: "prefix",
		// The detail page belongs to this item; finance is its own section.
		excludes: ["/engagements/finance"],
	},
	{
		key: "finance",
		to: "/engagements/finance",
		label: "Finance",
		icon: CircleDollarSign,
		match: "prefix",
		requires: "consultant",
		// A team's finance book is its own destination, listed under this one.
		excludes: ["/engagements/finance/team"],
	},
];

export function isEngagementsNavItemActive(
	item: EngagementsNavItem,
	currentPath: string,
): boolean {
	if (item.excludes?.some((prefix) => currentPath.startsWith(prefix))) {
		return false;
	}
	return item.match === "prefix"
		? currentPath.startsWith(item.to)
		: currentPath === item.to;
}

/**
 * The finance page's own tabs, as destinations.
 *
 * Not rendered in the sidebar — that is the point of the single Finance entry
 * above. They are listed here so the global search can still offer "Finance ·
 * Invoices": a tab is a place a user can mean to go, even when the sidebar
 * declines to name it.
 */
export const FINANCE_TAB_PAGES: {
	key: string;
	to: string;
	label: string;
	icon: LucideIcon;
}[] = [
	{
		key: "finance-overview",
		to: "/engagements/finance",
		label: "Overview",
		icon: BarChart3,
	},
	{
		key: "finance-contracts",
		to: "/engagements/finance/contracts",
		label: "Contracts",
		icon: FileSignature,
	},
	{
		key: "finance-invoices",
		to: "/engagements/finance/invoices",
		label: "Invoices",
		icon: ReceiptText,
	},
];
