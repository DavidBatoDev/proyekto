import {
	BarChart3,
	FileSignature,
	Handshake,
	type LucideIcon,
	ReceiptText,
} from "lucide-react";

/**
 * Navigation for the finance shell under `/engagements/finance`.
 *
 * Mirrors `marketplaceNavigation.ts` (icon on the item, one-file change to add
 * an entry). Split out because finance moved from the marketplace shell to its
 * own shell inside Engagements: the personal sections stay a consultant
 * capability, while the Teams group (appended at render time from the caller's
 * administered teams) is deliberately NOT consultant-gated — a project admin
 * runs team finance without ever being a marketplace consultant.
 */
export interface FinanceNavItem {
	key: string;
	to: string;
	label: string;
	icon: LucideIcon;
	match: "exact" | "prefix";
	requires?: "consultant";
	children?: FinanceNavChild[];
}

export interface FinanceNavChild {
	key: string;
	to: string;
	label: string;
	icon: LucideIcon;
}

export const FINANCE_NAV_ITEMS: FinanceNavItem[] = [
	// The way back to the engagements list this shell lives under.
	{
		key: "engagements",
		to: "/engagements",
		label: "Engagements",
		icon: Handshake,
		match: "exact",
	},
	{
		key: "finance-overview",
		to: "/engagements/finance",
		label: "Overview",
		icon: BarChart3,
		match: "exact",
		requires: "consultant",
	},
	{
		key: "finance-contracts",
		to: "/engagements/finance/contracts",
		label: "Contracts",
		icon: FileSignature,
		match: "prefix",
		requires: "consultant",
	},
	{
		key: "finance-invoices",
		to: "/engagements/finance/invoices",
		label: "Invoices",
		icon: ReceiptText,
		match: "prefix",
		requires: "consultant",
	},
];

export function isFinanceNavItemActive(
	item: FinanceNavItem,
	currentPath: string,
): boolean {
	return item.match === "prefix"
		? currentPath.startsWith(item.to)
		: currentPath === item.to;
}
