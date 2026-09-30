import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ImportWorkspace } from "@/components/finance/imports/ImportWorkspace";
import { FinanceTrail } from "@/components/finance/nav/FinanceTrail";
import { useHubTeam } from "@/components/finance/nav/useManagedTeams";
import { financeBooksService } from "@/services/financeBooks.service";

/**
 * One imported document, nested under the project whose ledger it records
 * into: team › project › Imports › <file>. "Up" is the project's Imports tab.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/project/$bookId/imports/$documentId",
)({
	component: ProjectImportDocumentPage,
});

function ProjectImportDocumentPage() {
	const { teamId, bookId, documentId } = Route.useParams();
	const navigate = useNavigate();
	const { team } = useHubTeam(teamId);
	// Same key as the project page, so the title is usually already cached.
	const overviewQuery = useQuery({
		queryKey: ["finance-books", bookId, "overview"],
		queryFn: () => financeBooksService.overview(bookId),
	});
	const teamName = team?.team_name ?? overviewQuery.data?.team_name ?? "Team";
	const title = overviewQuery.data?.project_title ?? "Project";

	return (
		<ImportWorkspace
			documentId={documentId}
			trail={(fileName) => (
				<FinanceTrail
					team={{ id: teamId, name: teamName }}
					project={{ bookId, title }}
					shared={team?.my_team_role === "guest"}
					section={{ label: "Imports", tab: "imports" }}
					current={fileName ?? "Document"}
				/>
			)}
			onOpenInvoice={() =>
				void navigate({
					to: "/engagements/finance/team/$teamId/project/$bookId",
					params: { teamId, bookId },
					search: { tab: "invoices" },
				})
			}
			onRecorded={() =>
				void navigate({
					to: "/engagements/finance/team/$teamId/project/$bookId",
					params: { teamId, bookId },
					search: { tab: "imports" },
				})
			}
		/>
	);
}
