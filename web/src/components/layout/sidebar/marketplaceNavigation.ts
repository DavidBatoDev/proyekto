import {
	BarChart3,
	CircleDollarSign,
	Compass,
	FileSignature,
	Handshake,
	type LucideIcon,
	ReceiptText,
	Search,
} from "lucide-react";

/**
 * Navigation for the marketplace shell.
 *
 * The icon lives on the item, unlike DASHBOARD_PRIMARY_NAV_ITEMS which keeps a
 * parallel PRIMARY_NAV_ICONS map in SidebarContent — that split is why nav
 * items there drift. Adding an entry here is a one-file change.
 *
 * `requires` gates on a marketplace capability, never on a declared identity:
 * "consultant" means `consultant_profiles.status = 'verified'`, resolved
 * through `isActiveConsultant`.
 */
export interface MarketplaceNavItem {
	key: string;
	to: string;
	label: string;
	icon: LucideIcon;
	match: "exact" | "prefix";
	requires?: "consultant";
	/**
	 * Sections revealed while the parent is the current area. Only meaningful
	 * for a `prefix` item — an exact item is a single page with nothing beneath
	 * it to expand into.
	 */
	children?: MarketplaceNavChild[];
}

export interface MarketplaceNavChild {
	key: string;
	to: string;
	label: string;
	icon: LucideIcon;
}

export const MARKETPLACE_NAV_ITEMS: MarketplaceNavItem[] = [
	{
		key: "finance",
		to: "/marketplace/finance",
		label: "Finance",
		icon: CircleDollarSign,
		match: "prefix",
		requires: "consultant",
		// These became real URLs when the finance sections stopped being `?tab=`
		// values, which is what lets the sidebar link straight into one.
		children: [
			{
				key: "finance-overview",
				to: "/marketplace/finance",
				label: "Overview",
				icon: BarChart3,
			},
			{
				key: "finance-contracts",
				to: "/marketplace/finance/contracts",
				label: "Contracts",
				icon: FileSignature,
			},
			{
				key: "finance-engagements",
				to: "/marketplace/finance/engagements",
				label: "Engagements",
				icon: Handshake,
			},
			{
				key: "finance-invoices",
				to: "/marketplace/finance/invoices",
				label: "Invoices",
				icon: ReceiptText,
			},
		],
	},
	{
		key: "consultant-marketplace",
		to: "/marketplace/talent/browse",
		label: "Find work",
		icon: Compass,
		match: "prefix",
		requires: "consultant",
	},
	{
		key: "browse-consultants",
		to: "/marketplace/consultant/browse",
		label: "Browse consultants",
		icon: Search,
		match: "prefix",
	},
	{
		key: "project-posting",
		to: "/marketplace/project-posting",
		label: "Post a project",
		icon: FileSignature,
		match: "exact",
	},
];

export function isMarketplaceNavItemActive(
	item: MarketplaceNavItem,
	currentPath: string,
): boolean {
	return item.match === "prefix"
		? currentPath.startsWith(item.to)
		: currentPath === item.to;
}

/**
 * Which finance section, if any, the current path is showing.
 *
 * Exact for the overview, prefix for the rest — otherwise `/marketplace/finance`
 * would light up every child, and `/marketplace/finance/invoices/new` would
 * light up none.
 *
 * A contract at `/marketplace/finance/<id>` deliberately matches no child: it
 * is reached from Contracts but is not itself a section, and highlighting one
 * would claim the user is somewhere they are not.
 */
export function isMarketplaceNavChildActive(
	child: MarketplaceNavChild,
	parent: MarketplaceNavItem,
	currentPath: string,
): boolean {
	return child.to === parent.to
		? currentPath === parent.to
		: currentPath.startsWith(child.to);
}
