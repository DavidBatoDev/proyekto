import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { FinanceQueryError } from "@/components/finance/access/FinanceAccessStates";
import { ImportWorkspace } from "@/components/finance/imports/ImportWorkspace";
import { FinanceTrail } from "@/components/finance/nav/FinanceTrail";
import {
	findProjectHome,
	useFinanceHub,
} from "@/components/finance/nav/useManagedTeams";
import { FinanceLoading } from "@/components/finance/portfolio/FinancePrimitives";
import { retryUnlessAccessDenied } from "@/lib/apiErrors";
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
		retry: retryUnlessAccessDenied(),
	});

	if (hubQuery.isPending || documentQuery.isPending) return <FinanceLoading />;
	if (documentQuery.isError) {
		return (
			<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
				<div className="mx-auto w-full max-w-3xl pb-10">
					<FinanceTrail current="Imports" />
					<FinanceQueryError
						className="mt-4"
						error={documentQuery.error}
						scope="document"
						onRetry={() => void documentQuery.refetch()}
					/>
				</div>
			</div>
		);
	}

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
