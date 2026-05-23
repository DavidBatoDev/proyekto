import { createFileRoute, redirect } from "@tanstack/react-router";
import { AlertCircle, ListChecks, Loader2 } from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { GlobalKanbanView } from "@/components/roadmap/views/kanban/GlobalKanbanView";
import { useAllRoadmapsFullQuery } from "@/hooks/useProjectQueries";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/work-items")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: WorkItemsPage,
});

function WorkItemsPage() {
	const query = useAllRoadmapsFullQuery();

	return (
		<DashboardShell>
			<div className="relative flex flex-col h-full min-h-0 bg-slate-50/30">
				{/* Header */}
				<div className="px-6 py-2.5 bg-white border-b border-slate-100 shrink-0">
					<div className="flex items-center gap-2.5">
						<div className="w-8 h-8 rounded-lg bg-[#0f172a]/10 flex items-center justify-center shrink-0">
							<ListChecks className="w-4 h-4 text-[#0f172a]" />
						</div>
						<div className="leading-tight">
							<h1 className="text-sm font-semibold text-slate-900">
								Work Items
							</h1>
							<p className="text-[11px] text-slate-400">
								Board view of every task across all projects
							</p>
						</div>
					</div>
				</div>

				{/* Body */}
				<div className="flex-1 min-h-0 flex flex-col">
					{query.isPending ? (
						<div className="flex-1 flex items-center justify-center text-slate-500">
							<Loader2 className="w-6 h-6 animate-spin" />
						</div>
					) : query.error ? (
						<div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
							<AlertCircle className="w-8 h-8 text-red-400" />
							<p className="text-sm font-medium text-slate-700">
								Couldn't load work items
							</p>
							<p className="text-xs text-slate-500">
								{query.error instanceof Error
									? query.error.message
									: "Unknown error"}
							</p>
						</div>
					) : (
						<GlobalKanbanView roadmaps={query.data ?? []} />
					)}
				</div>
			</div>
		</DashboardShell>
	);
}
