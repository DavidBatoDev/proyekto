import {
	BarChart3,
	CircleDollarSign,
	FileSignature,
	FileUp,
	Handshake,
	type LucideIcon,
	ReceiptText,
	UserRound,
} from "lucide-react";

/**
 * Navigation for the engagements shell at `/engagements`.
 *
 * The sidebar lists PLACES, Google-Drive style: All engagements, then the
 * three finance levels — Home (the launcher), Personal (your own book), and
 * one entry per team, each with its project books nested under it. Teams and
 * project books are appended at render time from the finance hub payload, so
 * this module only names the static places.
 *
 * Filters are not places: the engagement list's seat tabs and status filter,
 * and the portfolio's section tabs, live on their pages. Folding them in here
 * would mix filters into a sitemap.
 */
export interface EngagementsNavItem {
	key: string;
	to: string;
	label: string;
	icon: LucideIcon;
	match: "exact" | "prefix";
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
];

/**
 * The static finance places. Home matches only the launcher itself — every
 * deeper finance surface belongs to Personal, a team, or the portfolio.
 */
export const FINANCE_NAV_ITEMS: EngagementsNavItem[] = [
	{
		key: "finance-home",
		to: "/engagements/finance",
		label: "Home",
		icon: CircleDollarSign,
		match: "prefix",
		excludes: [
			"/engagements/finance/me",
			"/engagements/finance/team",
			"/engagements/finance/book",
			"/engagements/finance/portfolio",
			"/engagements/finance/contracts",
			"/engagements/finance/invoices",
			"/engagements/finance/imports",
		],
	},
	{
		key: "finance-personal",
		to: "/engagements/finance/me",
		label: "Personal",
		icon: UserRound,
		match: "prefix",
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
 * The consultant portfolio's own tabs, as destinations.
 *
 * Not rendered in the sidebar — the portfolio is one place. They are listed
 * here so the global search can still offer "Finance · Invoices": a tab is a
 * place a user can mean to go, even when the sidebar declines to name it.
 */
export const FINANCE_TAB_PAGES: {
	key: string;
	to: string;
	label: string;
	icon: LucideIcon;
}[] = [
	{
		key: "finance-portfolio",
		to: "/engagements/finance/portfolio",
		label: "Portfolio",
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
	{
		key: "finance-imports",
		to: "/engagements/finance/imports",
		label: "Imports",
		icon: FileUp,
	},
];
