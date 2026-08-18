import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EngagementPortfolio } from "@/components/finance/portfolio/EngagementPortfolio";
import { validateFinanceSharedSearch } from "@/components/finance/portfolio/financeSearch";
import { isActiveConsultant } from "@/lib/auth-utils";
import { engagementService } from "@/services/engagement.service";
import { useProfile } from "@/stores/authStore";

/**
 * Engagements the signed-in user is a party to.
 *
 * Only `projectId` of the shared filters reaches the API: `/api/engagements`
 * scopes by party membership and takes `kind`, `status` and `project_id`, so
 * the free-text and currency facets have nothing to bind to here. They stay in
 * the URL rather than being stripped, so moving back to Contracts keeps them.
 */
export const Route = createFileRoute(
	"/marketplace/finance/_portfolio/engagements",
)({
	validateSearch: validateFinanceSharedSearch,
	component: FinanceEngagementsPage,
});

function FinanceEngagementsPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const profile = useProfile();
	const isConsultant = isActiveConsultant(profile);

	const engagementsQuery = useQuery({
		queryKey: ["finance", "engagements", search.projectId],
		queryFn: () =>
			engagementService.list(
				search.projectId ? { project_id: search.projectId } : {},
			),
		enabled: isConsultant,
	});

	return (
		<EngagementPortfolio
			loading={engagementsQuery.isPending}
			error={engagementsQuery.error as Error | null}
			items={engagementsQuery.data ?? []}
			onOpenContract={(contractId) =>
				void navigate({
					to: "/marketplace/finance/$contractId",
					params: { contractId },
					search: { section: undefined },
				})
			}
		/>
	);
}
