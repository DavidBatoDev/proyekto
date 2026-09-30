import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { ImportWorkspace } from "@/components/finance/imports/ImportWorkspace";
import { FinanceTrail } from "@/components/finance/nav/FinanceTrail";
import {
	findProjectHome,
	useFinanceHub,
} from "@/components/finance/nav/useManagedTeams";
import { FinanceLoading } from "@/components/finance/portfolio/FinancePrimitives";
import { financeImportsService } from "@/services/financeImports.service";

/**
 * Legacy URL for an imported document. Forwards to the nested
 * `/team/$teamId/project/$bookId/imports/$documentId` when the document's
 * project has project finance; otherwise renders the workspace in place so
 * old links still work.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/imports/$documentId",
)({
	component: LegacyImportDocument,
});

function LegacyImportDocument() {
	const { documentId } = Route.useParams();
	const navigate = useNavigate();
	const hubQuery = useFinanceHub();
	const documentQuery = useQuery({
		queryKey: ["finance-import", "document", documentId],
		queryFn: () => financeImportsService.get(documentId),
	});

	if (hubQuery.isPending || documentQuery.isPending) return <FinanceLoading />;

	const home = findProjectHome(hubQuery.data, documentQuery.data?.project_id);
	if (home) {
		return (
			<Navigate
				to="/engagements/finance/team/$teamId/project/$bookId/imports/$documentId"
				params={{ ...home, documentId }}
				replace
			/>
		);
	}

	return (
		<ImportWorkspace
			documentId={documentId}
			trail={(fileName) => <FinanceTrail current={fileName ?? "Imports"} />}
			onRecorded={(projectId) =>
				void navigate({
					to: "/engagements/finance/imports",
					search: { projectId },
				})
			}
		/>
	);
}
