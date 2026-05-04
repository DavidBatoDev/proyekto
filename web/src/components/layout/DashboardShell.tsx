import type { ReactNode } from "react";
import { DashboardSidebar } from "./DashboardSidebar";

export function DashboardShell({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-screen pt-14 app-shell-bg">
			<DashboardSidebar />
			<main className="min-w-0 flex-1">{children}</main>
		</div>
	);
}
