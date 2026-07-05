import type { ReactNode } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { DashboardSidebar } from "./DashboardSidebar";

export function DashboardShell({ children }: { children: ReactNode }) {
	return (
		<ProtectedRoute loadingFallback={null}>
			<div className="flex min-h-screen pt-app-header app-shell-bg">
				<DashboardSidebar />
				<main className="min-w-0 flex-1">{children}</main>
			</div>
		</ProtectedRoute>
	);
}
