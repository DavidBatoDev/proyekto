import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SelectField } from "@/components/common/FormFields";
import { FinanceNoAccess } from "@/components/finance/access/FinanceAccessStates";
import { ProjectImportsPanel } from "@/components/finance/imports/ProjectImportsPanel";
import {
	findProjectHome,
	useFinanceHub,
} from "@/components/finance/nav/useManagedTeams";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { resolveImportsProject } from "@/components/finance/team/teamFinanceAccess";
import { useTeamFinanceAccess } from "@/components/finance/team/useTeamFinanceAccess";

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
	const hubQuery = useFinanceHub();

	// Only projects whose finance the caller may read: the team's attachment
	// list also carries projects they are merely an editor on, which the
	// documents endpoint then refuses.
	const { financeProjects: projects } = useTeamFinanceAccess(teamId);
	const { selected, refused } = resolveImportsProject(projectId, projects);
	const selectedProject = projects.find((project) => project.id === selected);

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
							...projects.map((project) => ({
								value: project.id,
								label: project.title ?? "Untitled project",
							})),
						]}
					/>
				</div>
				{refused ? (
					<FinanceNoAccess scope="project" />
				) : (
					<ProjectImportsPanel
						projectId={selected}
						canUpload={selectedProject?.can_manage_invoices ?? false}
						onOpenDocument={(documentId) => {
							const home = findProjectHome(hubQuery.data, selected);
							if (home) {
								void navigate({
									to: "/engagements/finance/team/$teamId/project/$bookId/imports/$documentId",
									params: { ...home, documentId },
								});
							} else {
								void navigate({
									to: "/engagements/finance/imports/$documentId",
									params: { documentId },
								});
							}
						}}
					/>
				)}
			</div>
		</TeamFinanceChrome>
	);
}
