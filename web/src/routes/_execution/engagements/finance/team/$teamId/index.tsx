import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Folder, Plus, Share2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import {
	FINANCE_ROLE_LABELS,
	FinanceShareDialog,
} from "@/components/finance/FinanceShareDialog";
import { InitialsStack, InitialsTile } from "@/components/finance/InitialsTile";
import { FinanceStatusBadge } from "@/components/finance/portfolio/FinancePrimitives";
import {
	type FinanceSharedSearch,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";
import { PortfolioOverview } from "@/components/finance/portfolio/PortfolioOverview";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { useTeamFinanceProjectOptions } from "@/components/finance/team/useTeamFinanceProjectOptions";
import { formatCurrency } from "@/lib/currency";
import type { FinanceContractSummary } from "@/services/finance.service";
import {
	type FinanceBookMember,
	type FinanceHubTeam,
	financeBooksService,
} from "@/services/financeBooks.service";
import { teamFinanceService } from "@/services/teamFinance.service";

/**
 * One team's finance overview: who is on the book, what the team has logged
 * and paid, and the places its money lives — a book per project with a signed
 * client contract, the talent contracts the team pays, and the people with
 * finance access.
 *
 * The revenue rollup sits beneath, and only once there is billing to roll up.
 * `cost`/`margin` come back null for a team administrator and the rollup
 * renders billed revenue instead; a project row drills into the team Invoices
 * tab, NOT the consultant's per-project financials (which stay owner-gated).
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
	const [shareOpen, setShareOpen] = useState(false);

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

	const hubQuery = useQuery({
		queryKey: ["finance-books", "hub"],
		queryFn: financeBooksService.hub,
		staleTime: 60_000,
	});
	const team = hubQuery.data?.teams.find((entry) => entry.team_id === teamId);
	const bookId = team?.book?.id;

	const membersQuery = useQuery({
		queryKey: ["finance-books", "members", bookId],
		queryFn: () => financeBooksService.listMembers(bookId as string),
		enabled: Boolean(bookId),
	});
	const members = membersQuery.data ?? [];

	const updateSearch = (patch: Partial<FinanceSharedSearch>) =>
		void navigate({
			to: "/engagements/finance/team/$teamId",
			params: { teamId },
			search: { ...search, ...patch },
			replace: true,
		});

	const hasRollup = (portfolioQuery.data?.projects.length ?? 0) > 0;
	const canManage =
		team?.book_role === "owner" || team?.book_role === "manager";

	return (
		<TeamFinanceChrome
			teamId={teamId}
			section="overview"
			search={search}
			projects={projectOptionsQuery.data?.projects ?? []}
			onChange={updateSearch}
			showFilters={hasRollup}
			roleLabel={
				team
					? (FINANCE_ROLE_LABELS[team.book_role ?? ""] ??
						capitalize(team.my_team_role))
					: undefined
			}
			actions={
				team ? (
					<>
						<InitialsStack names={members.map(memberName)} />
						{team.book ? (
							<button
								type="button"
								onClick={() => setShareOpen(true)}
								className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
							>
								<Share2 className="h-4 w-4" />
								Share
							</button>
						) : team.can_create ? (
							<Link
								to="/engagements/finance/setup/team"
								className="app-cta inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
							>
								<Plus className="h-4 w-4" />
								Create team book
							</Link>
						) : null}
					</>
				) : null
			}
		>
			{team ? (
				<TeamPlaces
					teamId={teamId}
					team={team}
					members={members}
					membersLoading={membersQuery.isPending && Boolean(bookId)}
					onShare={() => setShareOpen(true)}
				/>
			) : null}

			{hasRollup ? (
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
			) : null}

			{team?.book ? (
				<FinanceShareDialog
					bookId={team.book.id}
					bookTitle={`${team.team_name} · Team finance`}
					canManage={canManage}
					open={shareOpen}
					onClose={() => setShareOpen(false)}
				/>
			) : null}
		</TeamFinanceChrome>
	);
}

function capitalize(value: string): string {
	return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function memberName(member: FinanceBookMember): string {
	return (
		member.user?.display_name ??
		member.user?.email ??
		member.invited_email ??
		"Member"
	);
}

function formatHours(seconds: number): string {
	return `${(seconds / 3600).toFixed(1)}h`;
}

/**
 * The stat row and the three lists. Every figure is one the team book already
 * reports — hours by approval state and recorded payouts — so a tile is never
 * a placeholder; a team whose book is not set up yet simply has no tiles.
 */
function TeamPlaces({
	teamId,
	team,
	members,
	membersLoading,
	onShare,
}: {
	teamId: string;
	team: FinanceHubTeam;
	members: FinanceBookMember[];
	membersLoading: boolean;
	onShare: () => void;
}) {
	const bookId = team.book?.id;
	const overviewQuery = useQuery({
		queryKey: ["finance-books", "overview", bookId],
		queryFn: () => financeBooksService.overview(bookId as string),
		enabled: Boolean(bookId),
	});
	const talentQuery = useQuery({
		queryKey: ["team-finance", "contracts", teamId, "overview"],
		queryFn: () => teamFinanceService.contracts(teamId, { limit: 50 }),
	});
	const talentContracts = (talentQuery.data?.items ?? []).filter(
		(contract) => contract.relationship_kind === "talent_services",
	);

	const time = overviewQuery.data?.time;
	const payouts = overviewQuery.data?.payouts ?? [];

	return (
		<div className="space-y-8 pb-8">
			{bookId ? (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<StatTile
						label="Team hours"
						value={time ? formatHours(time.total_seconds) : "—"}
						hint={
							time?.by_member.length
								? `${time.by_member.length} ${time.by_member.length === 1 ? "person" : "people"} logged time`
								: "no time logged yet"
						}
					/>
					<StatTile
						label="Awaiting approval"
						value={time ? formatHours(time.pending_seconds) : "—"}
						hint="submitted, not yet decided"
						tone={time && time.pending_seconds > 0 ? "attention" : undefined}
					/>
					<StatTile
						label="Approved"
						value={time ? formatHours(time.approved_seconds) : "—"}
						hint="ready for payout"
					/>
					<StatTile
						label="Payouts recorded"
						value={
							payouts.length
								? payouts
										.map((row) => formatCurrency(row.total, row.currency))
										.join(" · ")
								: "—"
						}
						hint={
							payouts.length
								? `${payouts.reduce((sum, row) => sum + row.count, 0)} recorded`
								: "none recorded yet"
						}
						compact={payouts.length > 1}
					/>
				</div>
			) : null}

			<section>
				<SectionHeading
					title="Project finance"
					hint="One book per project with a signed client contract. Archived when the contract ends."
				/>
				<AppSurfaceCard className="overflow-hidden">
					{team.project_books.length === 0 ? (
						<EmptyRow>
							No project books yet — one opens when a project&apos;s client
							contract is signed.
						</EmptyRow>
					) : (
						team.project_books.map((entry) => (
							<Link
								key={entry.book.id}
								to="/engagements/finance/book/$bookId"
								params={{ bookId: entry.book.id }}
								className="flex items-center justify-between gap-4 border-b border-border/50 px-5 py-4 transition-colors last:border-b-0 hover:bg-muted/40"
							>
								<span className="flex min-w-0 items-center gap-3.5">
									<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
										<Folder className="h-[18px] w-[18px]" />
									</span>
									<span className="min-w-0">
										<span className="block truncate text-sm font-semibold text-foreground">
											{entry.project_title}
										</span>
										<span className="block truncate text-xs text-muted-foreground">
											Project finance · {entry.book.currency}
										</span>
									</span>
								</span>
								<span className="flex shrink-0 items-center gap-3">
									<FinanceStatusBadge status={entry.contract_status} />
									<ChevronRight className="h-4 w-4 text-muted-foreground" />
								</span>
							</Link>
						))
					)}
				</AppSurfaceCard>
			</section>

			<div className="grid gap-8 lg:grid-cols-2">
				<section>
					<SectionHeading
						title="Talent contracts"
						hint="What this team pays. Never visible to clients."
					/>
					<AppSurfaceCard className="overflow-hidden">
						{talentQuery.isPending ? (
							<EmptyRow>Loading…</EmptyRow>
						) : talentContracts.length === 0 ? (
							<EmptyRow>No talent contracts on this team yet.</EmptyRow>
						) : (
							talentContracts.map((contract) => (
								<TalentContractRow key={contract.id} contract={contract} />
							))
						)}
					</AppSurfaceCard>
				</section>

				<section>
					<SectionHeading
						title="Members"
						hint="Finance access only — it never opens the project workspace."
					/>
					<AppSurfaceCard className="overflow-hidden">
						{!bookId ? (
							<EmptyRow>
								Members are managed on the team book. Create it to invite an
								accountant or HR manager.
							</EmptyRow>
						) : membersLoading ? (
							<EmptyRow>Loading…</EmptyRow>
						) : (
							members.map((member) => (
								<div
									key={member.id ?? member.user_id ?? member.invited_email}
									className="flex items-center justify-between gap-4 border-b border-border/50 px-5 py-3.5 last:border-b-0"
								>
									<span className="flex min-w-0 items-center gap-3">
										<InitialsTile
											name={memberName(member)}
											shape="round"
											size="md"
										/>
										<span className="min-w-0">
											<span className="block truncate text-sm font-semibold text-foreground">
												{memberName(member)}
											</span>
											<span className="block truncate text-xs text-muted-foreground">
												{member.source === "team_owner"
													? "Team owner"
													: member.inherited
														? "Inherited access"
														: (member.user?.email ?? "Direct access")}
											</span>
										</span>
									</span>
									<span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
										{FINANCE_ROLE_LABELS[member.finance_role] ??
											member.finance_role}
									</span>
								</div>
							))
						)}
						{bookId &&
						(team.book_role === "owner" || team.book_role === "manager") ? (
							<button
								type="button"
								onClick={onShare}
								className="flex w-full items-center gap-3 border-t border-border/50 px-5 py-3.5 text-left text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
							>
								<span className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-border">
									<Plus className="h-4 w-4" />
								</span>
								Invite someone
							</button>
						) : null}
					</AppSurfaceCard>
				</section>
			</div>
		</div>
	);
}

function TalentContractRow({ contract }: { contract: FinanceContractSummary }) {
	const name = contract.provider_name ?? "Talent";
	// On a talent contract `client_hourly_rate` IS the talent's own rate — the
	// column is named for the client-services case it was first built for.
	const terms =
		contract.client_hourly_rate != null
			? `${formatCurrency(contract.client_hourly_rate, contract.currency)}/hr`
			: contract.recurring_fee != null
				? `${formatCurrency(contract.recurring_fee, contract.currency)} recurring`
				: contract.fixed_fee != null
					? `${formatCurrency(contract.fixed_fee, contract.currency)} fixed`
					: contract.billing_mode;
	return (
		<Link
			to="/engagements/finance/$contractId"
			params={{ contractId: contract.id }}
			search={{ section: undefined }}
			className="flex items-center justify-between gap-4 border-b border-border/50 px-5 py-3.5 transition-colors last:border-b-0 hover:bg-muted/40"
		>
			<span className="flex min-w-0 items-center gap-3">
				<InitialsTile name={name} shape="round" size="md" />
				<span className="min-w-0">
					<span className="block truncate text-sm font-semibold text-foreground">
						{name}
					</span>
					<span className="block truncate text-xs text-muted-foreground">
						{terms}
						{contract.scope_mode === "flexible" ? " · flexible" : ""}
					</span>
				</span>
			</span>
			<FinanceStatusBadge status={contract.status} />
		</Link>
	);
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
	return (
		<div className="mb-3">
			<h2 className="text-base font-semibold text-foreground">{title}</h2>
			<p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
		</div>
	);
}

function EmptyRow({ children }: { children: ReactNode }) {
	return <p className="px-5 py-4 text-sm text-muted-foreground">{children}</p>;
}

/**
 * A figure with the sentence that says what it counts. The hint is the point:
 * "6.0h" alone does not say whether that is good news or a queue.
 */
function StatTile({
	label,
	value,
	hint,
	tone,
	compact,
}: {
	label: string;
	value: string;
	hint: string;
	tone?: "attention";
	compact?: boolean;
}) {
	return (
		<div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
			<p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
				{label}
			</p>
			<p
				className={`mt-1.5 font-bold tracking-tight ${compact ? "text-base" : "text-2xl"} ${
					tone === "attention" ? "text-warning-foreground" : "text-foreground"
				}`}
			>
				{value}
			</p>
			<p className="mt-1 text-xs text-muted-foreground">{hint}</p>
		</div>
	);
}
