import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { ProjectBookTab } from "@/components/finance/book/ProjectBookWorkspace";
import { FinanceLoading } from "@/components/finance/portfolio/FinancePrimitives";
import {
	findProjectHome,
	useFinanceHub,
	useManagedTeams,
} from "./useManagedTeams";

/**
 * Forwards a legacy, project-scoped finance URL (`/finance/invoices?projectId=`,
 * `/finance/imports?projectId=`) to the one place that project's finance now
 * lives: its team's project page, on the matching tab. Without a project, it
 * goes to the caller's team tab of the same name. When the project has no
 * project finance yet, `fallback` renders in place so the link still works.
 */
export function ProjectHomeRedirect({
	projectId,
	tab,
	teamTab,
	fallback,
}: {
	projectId: string | undefined;
	tab: ProjectBookTab;
	teamTab: "invoices" | "imports";
	fallback: ReactNode;
}) {
	const hubQuery = useFinanceHub();
	const teams = useManagedTeams(hubQuery.data);
	if (hubQuery.isPending) return <FinanceLoading />;

	const home = findProjectHome(hubQuery.data, projectId);
	if (home) {
		return (
			<Navigate
				to="/engagements/finance/team/$teamId/project/$bookId"
				params={home}
				search={{ tab }}
				replace
			/>
		);
	}
	if (!projectId && teams.length > 0) {
		const teamId = teams[0].team_id;
		return teamTab === "invoices" ? (
			<Navigate
				to="/engagements/finance/team/$teamId/invoices"
				params={{ teamId }}
				replace
			/>
		) : (
			<Navigate
				to="/engagements/finance/team/$teamId/imports"
				params={{ teamId }}
				replace
			/>
		);
	}
	if (!projectId) return <Navigate to="/engagements/finance" replace />;
	return <>{fallback}</>;
}
