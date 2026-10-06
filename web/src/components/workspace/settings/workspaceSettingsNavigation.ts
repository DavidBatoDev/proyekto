import {
	Building2,
	Clock,
	CreditCard,
	Gauge,
	type LucideIcon,
	Users,
} from "lucide-react";
import { filterNavByPlatform } from "@/lib/platformSurfaces";

/**
 * The workspace settings nav, as data.
 *
 * Extracted from WorkspaceSettingsLayout so it can be filtered and tested the
 * way executionNavigation.ts and marketplaceNavigation.ts already are — the
 * layout renders this list TWICE (the desktop rail and the `md:hidden` tab
 * strip), so anything applied here cannot be fixed in one place and forgotten
 * in the other.
 *
 * Usage and Billing are commerce surfaces and drop out in the installed app;
 * `lib/platformSurfaces.ts` is the one place that decides that. Time (the
 * workspace time policy and report, ux.md › Settings) is a `/settings` app
 * surface, so it stays.
 */
export interface WorkspaceSettingsNavItem {
	label: string;
	to: string;
	icon: LucideIcon;
	active: boolean;
	/** Only General needs it: the other pages live under its path. */
	exact?: boolean;
}

/**
 * @param workspaceSlug the workspace whose settings these are
 * @param currentPath the location with `stripWorkspacePrefix` already applied
 * @param isNative whether this is the installed app
 */
export function workspaceSettingsNavItems(
	workspaceSlug: string,
	currentPath: string,
	isNative: boolean,
): WorkspaceSettingsNavItem[] {
	const items: WorkspaceSettingsNavItem[] = [
		{
			label: "General",
			to: `/w/${workspaceSlug}/settings`,
			icon: Building2,
			// Exact match — Members, Time, Usage and Billing live under this prefix.
			active: currentPath === "/settings" || currentPath === "/settings/",
			exact: true,
		},
		{
			label: "Members",
			to: `/w/${workspaceSlug}/settings/members`,
			icon: Users,
			active: currentPath.startsWith("/settings/members"),
		},
		{
			// Between Members and Usage (ux.md › Workspace Time Policy). Owners
			// and admins edit the policy; members read it.
			label: "Time",
			to: `/w/${workspaceSlug}/settings/time`,
			icon: Clock,
			// Segment-safe: a future /settings/timeline must not light it up.
			active: /^\/settings\/time(?:\/|$)/.test(currentPath),
		},
		{
			label: "Usage",
			to: `/w/${workspaceSlug}/settings/usage`,
			icon: Gauge,
			active: currentPath.startsWith("/settings/usage"),
		},
		{
			label: "Billing",
			to: `/w/${workspaceSlug}/settings/billing`,
			icon: CreditCard,
			active: currentPath.startsWith("/settings/billing"),
		},
	];

	return filterNavByPlatform(items, isNative);
}
