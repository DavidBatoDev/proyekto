import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Building2, FolderKanban } from "lucide-react";
import { useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import {
	FINANCE_CRUMB_LINK_CLASS,
	FinanceBreadcrumbs,
	FinanceCurrentCrumb,
} from "@/components/finance/portfolio/FinanceBreadcrumbs";
import { financeBooksService } from "@/services/financeBooks.service";
import { listMyTeams, listTeamProjects } from "@/services/teams.service";

/**
 * The F2 creation wizard — team owners only. Pick an owned team, tick the
 * projects that should become F3 child books, choose a currency, create.
 * Eligibility (a signed client contract on the project) is enforced by the
 * backend; a refusal names the offending projects and is surfaced verbatim.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/setup/team",
)({
	component: TeamFinanceSetupPage,
});

const CURRENCIES = ["USD", "EUR", "GBP", "PHP", "AUD", "SGD", "CAD", "JPY"];

function TeamFinanceSetupPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [teamId, setTeamId] = useState<string | null>(null);
	const [currency, setCurrency] = useState("USD");
	const [selectedProjects, setSelectedProjects] = useState<Set<string>>(
		new Set(),
	);

	const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: listMyTeams });
	const ownedTeams = (teamsQuery.data ?? []).filter(
		(team) => team.viewer_role === "owner",
	);

	const projectsQuery = useQuery({
		queryKey: ["teams", teamId, "projects"],
		queryFn: () => listTeamProjects(teamId as string),
		enabled: Boolean(teamId),
	});

	const createMutation = useMutation({
		mutationFn: () =>
			financeBooksService.createTeam({
				team_id: teamId as string,
				project_ids: [...selectedProjects],
				currency,
			}),
		onSuccess: async ({ book }) => {
			await queryClient.invalidateQueries({ queryKey: ["finance-books"] });
			void navigate({
				to: "/engagements/finance/book/$bookId",
				params: { bookId: book.id },
			});
		},
	});

	const toggleProject = (projectId: string) => {
		setSelectedProjects((current) => {
			const next = new Set(current);
			if (next.has(projectId)) next.delete(projectId);
			else next.add(projectId);
			return next;
		});
	};

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-3xl">
				<FinanceBreadcrumbs
					items={[
						<Link
							key="engagements"
							to="/engagements"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Engagements
						</Link>,
						<Link
							key="finance"
							to="/engagements/finance"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Finance
						</Link>,
						<FinanceCurrentCrumb key="setup">
							Set up team finance
						</FinanceCurrentCrumb>,
					]}
				/>

				<AppSectionHeader
					title="Set up team finance"
					subtitle="A shared book for a team you own: member rates, payouts, client invoices, and a child book for each contracted project. You can invite an HR manager, accountant, or client viewer after creating it."
					className="mt-4"
				/>

				{teamsQuery.isPending ? (
					<p className="mt-5 text-sm text-slate-500">Loading your teams…</p>
				) : ownedTeams.length === 0 ? (
					<AppEmptyState
						icon={Building2}
						title="You don't own a team yet"
						description="Team finance is created by the team's owner. Create a team first, or ask your team's owner to set up its finance book."
						className="mt-5"
					/>
				) : (
					<>
						<AppSurfaceCard className="mt-5 p-5">
							<label
								htmlFor="finance-team"
								className="text-sm font-semibold text-slate-900"
							>
								Team
							</label>
							<p className="mt-0.5 text-xs text-slate-500">
								Only teams you own are listed — the book belongs to the team,
								and ownership follows the team.
							</p>
							<select
								id="finance-team"
								value={teamId ?? ""}
								onChange={(event) => {
									setTeamId(event.target.value || null);
									setSelectedProjects(new Set());
								}}
								className="mt-3 w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
							>
								<option value="">Pick a team…</option>
								{ownedTeams.map((team) => (
									<option key={team.id} value={team.id}>
										{team.name}
									</option>
								))}
							</select>

							<label
								htmlFor="finance-currency"
								className="mt-5 block text-sm font-semibold text-slate-900"
							>
								Display currency
							</label>
							<p className="mt-0.5 text-xs text-slate-500">
								Figures keep their native currency; this only sets how the book
								groups and leads.
							</p>
							<select
								id="finance-currency"
								value={currency}
								onChange={(event) => setCurrency(event.target.value)}
								className="mt-3 w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
							>
								{CURRENCIES.map((code) => (
									<option key={code} value={code}>
										{code}
									</option>
								))}
							</select>
						</AppSurfaceCard>

						{teamId ? (
							<>
								<AppSectionHeader
									title="Project books"
									subtitle="Tick the projects that should get their own child book. Only projects with a signed client contract can join finance — anything else is refused when you create."
									className="mt-8"
								/>
								{projectsQuery.isPending ? (
									<p className="mt-3 text-sm text-slate-500">
										Loading the team's projects…
									</p>
								) : (projectsQuery.data?.length ?? 0) === 0 ? (
									<AppEmptyState
										icon={FolderKanban}
										title="No projects attached to this team"
										description="You can create the team book now and add project books later, once projects with signed client contracts are attached."
										className="mt-3"
									/>
								) : (
									<div className="mt-3 space-y-2">
										{(projectsQuery.data ?? []).map((attachment) => (
											<label
												key={attachment.project_id}
												className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 shadow-sm transition-colors hover:border-slate-400"
											>
												<input
													type="checkbox"
													checked={selectedProjects.has(attachment.project_id)}
													onChange={() => toggleProject(attachment.project_id)}
													className="h-4 w-4 rounded border-slate-300"
												/>
												<span className="truncate text-sm font-semibold text-slate-900">
													{attachment.project?.title ?? "Untitled project"}
												</span>
											</label>
										))}
									</div>
								)}
							</>
						) : null}

						{createMutation.isError ? (
							<p className="mt-4 text-sm font-medium text-red-600">
								{createMutation.error.message}
							</p>
						) : null}

						<div className="mt-6 flex items-center gap-3">
							<button
								type="button"
								disabled={!teamId || createMutation.isPending}
								onClick={() => createMutation.mutate()}
								className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
							>
								<Building2 className="h-4 w-4" />
								{createMutation.isPending ? "Creating…" : "Create team finance"}
							</button>
							<Link
								to="/engagements/finance"
								className="text-sm font-medium text-slate-600 hover:text-slate-900"
							>
								Cancel
							</Link>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
