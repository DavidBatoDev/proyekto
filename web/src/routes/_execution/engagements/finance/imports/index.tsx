import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectImportsPanel } from "@/components/finance/imports/ProjectImportsPanel";
import { FinanceTrail } from "@/components/finance/nav/FinanceTrail";
import { ProjectHomeRedirect } from "@/components/finance/nav/ProjectHomeRedirect";
import { stringValue } from "@/components/finance/portfolio/financeSearch";

interface ImportsSearch {
	projectId?: string;
}

/**
 * Legacy entry point for imports. Forwards to the project's Imports tab under
 * its team; a project without project finance yet keeps the uploader here.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/imports/",
)({
	validateSearch: (search: Record<string, unknown>): ImportsSearch => ({
		projectId: stringValue(search.projectId),
	}),
	component: ImportsEntry,
});

function ImportsEntry() {
	const { projectId } = Route.useSearch();
	const navigate = useNavigate();
	return (
		<ProjectHomeRedirect
			projectId={projectId}
			tab="imports"
			teamTab="imports"
			fallback={
				<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
					<div className="mx-auto w-full max-w-7xl pb-10">
						<FinanceTrail current="Imports" />
						<div className="mt-4">
							<ProjectImportsPanel
								projectId={projectId}
								onOpenDocument={(documentId) =>
									void navigate({
										to: "/engagements/finance/imports/$documentId",
										params: { documentId },
									})
								}
							/>
						</div>
					</div>
				</div>
			}
		/>
	);
}
