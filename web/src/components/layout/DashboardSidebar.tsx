import { SidebarContent } from "./sidebar/SidebarContent";

/**
 * Desktop sidebar (≥ lg). Below lg it's hidden and the mobile slide-in
 * `MobileNavDrawer` (triggered from the header hamburger) renders the same
 * `SidebarContent` instead.
 */
export function DashboardSidebar() {
	return (
		<aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground backdrop-blur lg:flex">
			<SidebarContent />
		</aside>
	);
}
