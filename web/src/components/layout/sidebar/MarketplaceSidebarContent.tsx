import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { isActiveConsultant } from "@/lib/auth-utils";
import { useProfile } from "@/stores/authStore";
import {
	isMarketplaceNavItemActive,
	MARKETPLACE_NAV_ITEMS,
} from "./marketplaceNavigation";
import { SidebarNavLink, SidebarSectionHeader } from "./SidebarPrimitives";

/**
 * The marketplace shell's navigation.
 *
 * Deliberately does NOT fetch teams or projects the way SidebarContent does.
 * Those are execution concerns, and loading them here would have the
 * marketplace depend on execution data just to draw a sidebar.
 */
export function MarketplaceSidebarContent() {
	const profile = useProfile();
	const consultant = isActiveConsultant(profile);
	const currentPath = useRouterState({
		select: (state) => state.location.pathname,
	});

	const items = MARKETPLACE_NAV_ITEMS.filter(
		(item) => item.requires !== "consultant" || consultant,
	);

	return (
		<div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4">
			<nav className="space-y-1">
				<SidebarSectionHeader>Marketplace</SidebarSectionHeader>
				{items.map((item) => (
					<SidebarNavLink
						key={item.key}
						to={item.to}
						icon={item.icon}
						label={item.label}
						active={isMarketplaceNavItemActive(item, currentPath)}
					/>
				))}
			</nav>

			<div className="mt-auto border-t border-sidebar-border pt-3">
				{/* The mode switch back to execution. Execution stands on its own, so
            this is a plain link, not a shared context the two shells share. */}
				<Link
					to="/dashboard"
					className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
				>
					<ArrowLeft className="h-5 w-5 shrink-0" />
					<span className="truncate">Back to workspace</span>
				</Link>
			</div>
		</div>
	);
}
