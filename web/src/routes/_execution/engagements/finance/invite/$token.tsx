import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CircleDollarSign, MailQuestion } from "lucide-react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { FinanceLoading } from "@/components/finance/portfolio/FinancePrimitives";
import { financeBooksService } from "@/services/financeBooks.service";

/**
 * The finance-invite landing page. The token in the URL is the credential —
 * the same precedent as contract signing links — so whoever holds it (and is
 * signed in) may accept, even from a different email address.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/invite/$token",
)({
	component: FinanceInvitePage,
});

const ROLE_LABELS: Record<string, string> = {
	manager: "Manager",
	accountant: "Accountant",
	viewer_client: "Client viewer",
	viewer: "Viewer",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
	manager:
		"You will see costs and manage member rates and payouts on this book.",
	accountant:
		"You will view and export time logs and payouts. Nothing is editable.",
	viewer_client:
		"You will see your contracts and invoices. Internal costs stay hidden.",
	viewer: "You will have a read-only view of time logs.",
};

function FinanceInvitePage() {
	const { token } = Route.useParams();
	const navigate = useNavigate();

	const previewQuery = useQuery({
		queryKey: ["finance-invites", token],
		queryFn: () => financeBooksService.getInvite(token),
	});

	const acceptMutation = useMutation({
		mutationFn: () => financeBooksService.acceptInvite(token),
		onSuccess: ({ book_id }) => {
			void navigate({
				to: "/engagements/finance/book/$bookId",
				params: { bookId: book_id },
			});
		},
	});

	const declineMutation = useMutation({
		mutationFn: () => financeBooksService.declineInvite(token),
		onSuccess: () => {
			void navigate({ to: "/engagements/finance" });
		},
	});

	if (previewQuery.isPending) return <FinanceLoading />;

	if (previewQuery.isError) {
		return (
			<div className="app-shell-bg min-h-full px-5 py-8">
				<div className="mx-auto w-full max-w-xl">
					<AppEmptyState
						icon={MailQuestion}
						title="Invitation not found"
						description="This finance invitation does not exist or was removed. Ask the person who sent it for a fresh link."
					/>
				</div>
			</div>
		);
	}

	const preview = previewQuery.data;
	const { invite, book } = preview;
	const bookLabel = book.team?.name
		? `${book.team.name} — ${book.kind === "project" ? "project finance" : "team finance"}`
		: book.kind === "project"
			? "Project finance"
			: "Team finance";
	const settled = invite.status !== "pending";

	return (
		<div className="app-shell-bg min-h-full px-5 py-8">
			<div className="mx-auto w-full max-w-xl">
				<AppSurfaceCard className="p-6">
					<div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600">
						<CircleDollarSign className="h-5 w-5" />
					</div>
					<h1 className="text-xl font-semibold tracking-tight text-slate-900">
						Finance invitation
					</h1>
					<p className="mt-2 text-sm text-slate-600">
						{preview.invited_by?.display_name ?? "Someone on Proyekto"} invited{" "}
						<span className="font-medium text-slate-900">{invite.email}</span>{" "}
						to join{" "}
						<span className="font-medium text-slate-900">{bookLabel}</span> as{" "}
						<span className="font-medium text-slate-900">
							{ROLE_LABELS[invite.finance_role] ?? invite.finance_role}
						</span>
						.
					</p>
					<p className="mt-2 text-sm text-slate-600">
						{ROLE_DESCRIPTIONS[invite.finance_role] ??
							"You will get finance-only access to this book."}{" "}
						Finance access never grants access to the project work itself.
					</p>

					{settled ? (
						<p className="mt-5 rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700 capitalize">
							This invitation is {invite.status}.
						</p>
					) : (
						<>
							{acceptMutation.isError ? (
								<p className="mt-4 text-sm font-medium text-red-600">
									{acceptMutation.error.message}
								</p>
							) : null}
							{declineMutation.isError ? (
								<p className="mt-4 text-sm font-medium text-red-600">
									{declineMutation.error.message}
								</p>
							) : null}
							<div className="mt-6 flex items-center gap-3">
								<button
									type="button"
									disabled={
										acceptMutation.isPending || declineMutation.isPending
									}
									onClick={() => acceptMutation.mutate()}
									className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
								>
									{acceptMutation.isPending ? "Accepting…" : "Accept"}
								</button>
								<button
									type="button"
									disabled={
										acceptMutation.isPending || declineMutation.isPending
									}
									onClick={() => declineMutation.mutate()}
									className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-900 hover:text-slate-900 disabled:opacity-60"
								>
									{declineMutation.isPending ? "Declining…" : "Decline"}
								</button>
							</div>
						</>
					)}

					<p className="mt-6 text-xs text-slate-500">
						Expires {new Date(invite.expires_at).toLocaleDateString()}.{" "}
						<Link
							to="/engagements/finance"
							className="font-medium text-slate-700 underline-offset-2 hover:underline"
						>
							Go to Finance
						</Link>
					</p>
				</AppSurfaceCard>
			</div>
		</div>
	);
}
