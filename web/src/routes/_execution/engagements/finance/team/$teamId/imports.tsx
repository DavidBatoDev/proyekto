import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SelectField } from "@/components/common/FormFields";
import { ProjectImportsPanel } from "@/components/finance/imports/ProjectImportsPanel";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { listTeamProjects } from "@/services/teams.service";

interface TeamImportsSearch {
	projectId?: string;
}

/**
 * Imports (OCR): record billing that happened outside Proyekto against one of
 * the team's projects — upload the invoice or proof of payment, then snip its
 * figures from the document into the project's ledger.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/imports",
)({
	validateSearch: (search: Record<string, unknown>): TeamImportsSearch => ({
		projectId:
			typeof search.projectId === "string" && search.projectId
				? search.projectId
				: undefined,
	}),
	component: TeamImportsPage,
});

function TeamImportsPage() {
	const { teamId } = Route.useParams();
	const { projectId } = Route.useSearch();
	const navigate = useNavigate();

	const projectsQuery = useQuery({
		queryKey: ["teams", teamId, "projects"],
		queryFn: () => listTeamProjects(teamId),
	});
	const projects = projectsQuery.data ?? [];
	// With one project there is nothing to choose.
	const selected =
		projectId ?? (projects.length === 1 ? projects[0].project_id : undefined);

	return (
		<TeamFinanceChrome
			teamId={teamId}
			section="imports"
			subtitle="Record invoices and payments made outside Proyekto, read straight from the document."
		>
			<div className="space-y-5 pb-8">
				<div className="max-w-sm">
					<SelectField
						label="Project"
						value={selected ?? ""}
						onChange={(value) =>
							void navigate({
								to: "/engagements/finance/team/$teamId/imports",
								params: { teamId },
								search: { projectId: value || undefined },
								replace: true,
							})
						}
						options={[
							{ value: "", label: "Choose a project…" },
							...projects.map((attachment) => ({
								value: attachment.project_id,
								label: attachment.project?.title ?? "Untitled project",
							})),
						]}
					/>
				</div>
				<ProjectImportsPanel
					projectId={selected}
					onOpenDocument={(documentId) =>
						void navigate({
							to: "/engagements/finance/imports/$documentId",
							params: { documentId },
						})
					}
				/>
			</div>
		</TeamFinanceChrome>
	);
}
