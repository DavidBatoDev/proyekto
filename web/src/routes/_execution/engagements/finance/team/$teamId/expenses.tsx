import { createFileRoute } from "@tanstack/react-router";
import { ExpensesPanel } from "@/components/finance/expenses/ExpensesPanel";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";

/**
 * Money out: recorded expenses plus payouts (counted as salary). Owners,
 * managers, and accountants record; anyone who can see costs reads.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/expenses",
)({
	component: TeamExpensesPage,
});

function TeamExpensesPage() {
	const { teamId } = Route.useParams();
	return (
		<TeamFinanceChrome
			teamId={teamId}
			section="expenses"
			subtitle="Money out — salaries, contractors, software, subscriptions, overhead, and taxes."
		>
			<ExpensesPanel teamId={teamId} />
		</TeamFinanceChrome>
	);
}
