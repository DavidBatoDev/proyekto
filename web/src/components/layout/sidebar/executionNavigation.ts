import {
	CalendarDays,
	Inbox,
	LayoutDashboard,
	ListChecks,
	type LucideIcon,
	Store,
} from "lucide-react";

/**
 * Primary navigation for the execution shell.
 *
 * The icon lives on the item. It used to sit in a parallel PRIMARY_NAV_ICONS
 * map inside SidebarContent, which meant adding an entry took two edits and
 * quietly rendered nothing if you forgot the second.
 *
 * Finance is deliberately NOT here any more. It is a marketplace surface, and
 * leaving it in the execution sidebar would contradict the boundary the shells
 * exist to draw. `marketplace` is the entry point instead — the mirror of the
 * marketplace shell's "Back to workspace" link. It carries no capability gate:
 * the marketplace decides for itself what a given visitor may see.
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
	{
		key: "marketplace",
		to: "/marketplace",
		label: "Marketplace",
		icon: Store,
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
