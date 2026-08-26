import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	type FinanceSharedSearch,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";
import { PortfolioOverview } from "@/components/finance/portfolio/PortfolioOverview";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { useTeamFinanceProjectOptions } from "@/components/finance/team/useTeamFinanceProjectOptions";
import { teamFinanceService } from "@/services/teamFinance.service";

/**
 * One team's finance overview — the team administrator's ("HR") revenue-side
 * portfolio. `cost`/`margin` come back null and the overview renders billed
 * revenue instead; a project row drills into the team Invoices tab, NOT the
 * consultant's per-project financials (which stay owner-gated).
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/",
)({
	validateSearch: (search: Record<string, unknown>): FinanceSharedSearch =>
		validateFinanceSharedSearch(search),
	component: TeamFinanceOverviewPage,
});

function TeamFinanceOverviewPage() {
	const { teamId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();

	const filters = {
		q: search.q,
		project_id: search.projectId,
		project_status: search.projectStatus,
		currency: search.currency,
		from: search.from,
		to: search.to,
	};
	const portfolioQuery = useQuery({
		queryKey: ["team-finance", "portfolio", teamId, filters],
		queryFn: () => teamFinanceService.portfolio(teamId, filters),
	});
	const projectOptionsQuery = useTeamFinanceProjectOptions(teamId, search);

	const updateSearch = (patch: Partial<FinanceSharedSearch>) =>
		void navigate({
			to: "/engagements/finance/team/$teamId",
			params: { teamId },
			search: { ...search, ...patch },
			replace: true,
		});

	return (
		<TeamFinanceChrome
			teamId={teamId}
			section="overview"
			search={search}
			projects={projectOptionsQuery.data?.projects ?? []}
			onChange={updateSearch}
		>
			<PortfolioOverview
				loading={portfolioQuery.isPending}
				portfolio={portfolioQuery.data}
				onOpen={(projectId) =>
					void navigate({
						to: "/engagements/finance/team/$teamId/invoices",
						params: { teamId },
						search: { ...search, projectId },
					})
				}
			/>
		</TeamFinanceChrome>
	);
}
