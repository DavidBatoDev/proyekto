import {
	CalendarDays,
	Clock,
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

/**
 * A condition an item needs before it shows. `time`: the caller can log time,
 * has timesheets waiting, or administers a workspace's time policy — read
 * from `GET /api/time/me/overview` (see `isTimeNavVisible`).
 */
export type ExecutionNavGate = "time";

export interface ExecutionNavItem {
	key: string;
	to: string;
	label: string;
	icon: LucideIcon;
	match: "exact" | "prefix";
	/** Absent: always shown. Present: shown only when that gate is open. */
	gate?: ExecutionNavGate;
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
		label: "Command center",
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
		// Covers /time and /time/timesheets/<id>. Bare on purpose: /time is a
		// personal page, so toWorkspacePath leaves it alone.
		key: "time",
		to: "/time",
		label: "Time",
		icon: Clock,
		match: "prefix",
		gate: "time",
	},
];

/** Which gates are open. A gate that is missing or `undefined` is closed. */
export type ExecutionNavGates = Partial<Record<ExecutionNavGate, boolean>>;

/**
 * The items to render. Ungated items always show; a gated item shows only
 * when its gate is explicitly open, so a Time item never flashes in while the
 * overview is still loading and then disappears.
 */
export function visibleExecutionNavItems(
	gates: ExecutionNavGates,
	items: readonly ExecutionNavItem[] = EXECUTION_PRIMARY_NAV_ITEMS,
): ExecutionNavItem[] {
	return items.filter((item) => !item.gate || gates[item.gate] === true);
}

/**
 * The subset of `GET /api/time/me/overview` the Time item reads. Structural,
 * so this module does not depend on the time service.
 */
export interface TimeNavOverview {
	can_log?: boolean | null;
	approvals_waiting?: number | null;
	workspace_time_admin?: readonly unknown[] | null;
}

/**
 * ux.md › Personas: the Time item shows when the overview says the caller can
 * log, has approvals waiting, or administers at least one workspace's time
 * policy. Guests get `can_log: false` and nothing else, so they never see it.
 * No overview yet (loading or failed) keeps it hidden.
 */
export function isTimeNavVisible(
	overview: TimeNavOverview | null | undefined,
): boolean {
	if (!overview) return false;
	return (
		overview.can_log === true ||
		(overview.approvals_waiting ?? 0) > 0 ||
		(overview.workspace_time_admin?.length ?? 0) > 0
	);
}

/** Segment-safe: `/time` is active on `/time/timesheets/x`, never on `/timeline`. */
export function isExecutionNavItemActive(
	item: ExecutionNavItem,
	currentPath: string,
): boolean {
	return item.match === "prefix"
		? currentPath === item.to || currentPath.startsWith(`${item.to}/`)
		: currentPath === item.to;
}
