import {
	CircleDollarSign,
	Compass,
	FileSignature,
	type LucideIcon,
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
}

export const MARKETPLACE_NAV_ITEMS: MarketplaceNavItem[] = [
	{
		key: "finance",
		to: "/marketplace/finance",
		label: "Finance",
		icon: CircleDollarSign,
		match: "prefix",
		requires: "consultant",
	},
	{
		key: "consultant-marketplace",
		to: "/marketplace/talent",
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
