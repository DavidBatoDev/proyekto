import {
	CalendarDays,
	Inbox,
	LayoutDashboard,
	ListChecks,
	type LucideIcon,
} from "lucide-react";

/**
 * Primary navigation for the execution shell.
 *
 * The icon lives on the item. It used to sit in a parallel PRIMARY_NAV_ICONS
 * map inside SidebarContent, which meant adding an entry took two edits and
 * quietly rendered nothing if you forgot the second.
 *
 * Nothing marketplace-shaped belongs here — not Finance, and not the
 * marketplace itself. Crossing between the two halves of the product is a
 * top-level move, so it lives in the global header nav (DashboardHeader) where
 * it is reachable from every page, including the marketplace's public ones that
 * render no sidebar at all. Putting it here as well would give the same jump two
 * homes at two levels of the hierarchy.
 */
export interface ExecutionNavItem {
	key: string;
	to: string;
	label: string;
	icon: LucideIcon;
	match: "exact" | "prefix";
}

export const EXECUTION_PRIMARY_NAV_ITEMS: ExecutionNavItem[] = [
	{
		key: "dashboard",
		to: "/dashboard",
		label: "Dashboard",
		icon: LayoutDashboard,
		match: "exact",
	},
	{ key: "inbox", to: "/inbox", label: "Inbox", icon: Inbox, match: "prefix" },
	{
		key: "command-center",
		to: "/command-center",
		label: "Command Center",
		icon: ListChecks,
		match: "exact",
	},
	{
		key: "meetings",
		to: "/meetings",
		label: "Meetings",
		icon: CalendarDays,
		match: "prefix",
	},
];

export function isExecutionNavItemActive(
	item: ExecutionNavItem,
	currentPath: string,
): boolean {
	return item.match === "prefix"
		? currentPath.startsWith(item.to)
		: currentPath === item.to;
}
