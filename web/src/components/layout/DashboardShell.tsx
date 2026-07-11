import type { ReactNode } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { DashboardSidebar } from "./DashboardSidebar";

export function DashboardShell({ children }: { children: ReactNode }) {
	return (
		<ProtectedRoute loadingFallback={null}>
			<div className="app-shell-bg flex min-h-screen bg-background pt-app-header text-foreground">
				<DashboardSidebar />
				<main className="min-w-0 flex-1">{children}</main>
			</div>
		</ProtectedRoute>
	);
}
