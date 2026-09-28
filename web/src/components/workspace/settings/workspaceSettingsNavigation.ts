import {
	Building2,
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
 * `lib/platformSurfaces.ts` is the one place that decides that.
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
			// Exact match — Members, Usage and Billing live under this prefix.
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
