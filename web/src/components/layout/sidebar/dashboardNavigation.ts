export const DASHBOARD_PRIMARY_NAV_ITEMS = [
	{ key: "dashboard", to: "/dashboard", label: "Dashboard", match: "exact" },
	{ key: "inbox", to: "/inbox", label: "Inbox", match: "prefix" },
	{
		key: "command-center",
		to: "/command-center",
		label: "Command Center",
		match: "exact",
	},
	{ key: "meetings", to: "/meetings", label: "Meetings", match: "prefix" },
] as const;

export type DashboardPrimaryNavItem =
	(typeof DASHBOARD_PRIMARY_NAV_ITEMS)[number];

export function isDashboardPrimaryNavItemActive(
	item: DashboardPrimaryNavItem,
	currentPath: string,
): boolean {
	return item.match === "prefix"
		? currentPath.startsWith(item.to)
		: currentPath === item.to;
}
