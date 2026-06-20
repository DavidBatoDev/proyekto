import { SidebarContent } from "./sidebar/SidebarContent";

/**
 * Desktop sidebar (≥ lg). Below lg it's hidden and the mobile slide-in
 * `MobileNavDrawer` (triggered from the header hamburger) renders the same
 * `SidebarContent` instead.
 */
export function DashboardSidebar() {
	return (
		<aside className="hidden lg:flex sticky top-14 h-[calc(100vh-3.5rem)] w-[260px] shrink-0 flex-col border-r border-slate-200 bg-white/90 backdrop-blur">
			<SidebarContent />
		</aside>
	);
}
