import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { AppEmptyState } from "@/components/common/AppPrimitives";
import { FinanceLoading } from "@/components/finance/portfolio/FinancePrimitives";
import { financeBooksService } from "@/services/financeBooks.service";

/**
 * Redirect-only. A book is storage, not a place: a team book IS its team page,
 * a project book lives under its team, and a personal book is My finance.
 * This URL survives only for invites, emails, and bookmarks that carry it.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/book/$bookId/",
)({
	component: FinanceBookRedirect,
});

function FinanceBookRedirect() {
	const { bookId } = Route.useParams();
	const overviewQuery = useQuery({
		queryKey: ["finance-books", bookId, "overview"],
		queryFn: () => financeBooksService.overview(bookId),
	});

	if (overviewQuery.isPending) return <FinanceLoading />;
	const book = overviewQuery.data?.book;

	if (!book) {
		return (
			<div className="mx-auto mt-12 max-w-xl px-5">
				<AppEmptyState
					icon={BookOpen}
					title="Finance not found"
					description={
						overviewQuery.error?.message ??
						"This finance page could not be loaded."
					}
				/>
			</div>
		);
	}
	if (book.kind === "project" && book.owner_team_id) {
		return (
			<Navigate
				to="/engagements/finance/team/$teamId/project/$bookId"
				params={{ teamId: book.owner_team_id, bookId: book.id }}
				replace
			/>
		);
	}
	if (book.kind === "team" && book.owner_team_id) {
		return (
			<Navigate
				to="/engagements/finance/team/$teamId"
				params={{ teamId: book.owner_team_id }}
				replace
			/>
		);
	}
	return <Navigate to="/engagements/finance" replace />;
}
