import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowRight,
	ChevronRight,
	CircleDollarSign,
	FileSignature,
} from "lucide-react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { InitialsTile } from "@/components/finance/InitialsTile";
import {
	InvoicesToPaySection,
	MyRateCard,
} from "@/components/finance/me/PersonalSections";
import { FinanceTrail } from "@/components/finance/nav/FinanceTrail";
import {
	findProjectHome,
	useFinanceHub,
} from "@/components/finance/nav/useManagedTeams";
import { FinanceLoading } from "@/components/finance/portfolio/FinancePrimitives";
import { PortfolioOverview } from "@/components/finance/portfolio/PortfolioOverview";
import { isActiveConsultant } from "@/lib/auth-utils";
import { formatCurrency } from "@/lib/currency";
import { engagementService } from "@/services/engagement.service";
import { financeService } from "@/services/finance.service";
import {
	financeBooksService,
	type MyFinanceSummary,
	type MyFinanceTeam,
} from "@/services/financeBooks.service";
import { useProfile } from "@/stores/authStore";

/**
 * My finance — the consolidated view across every team the caller owns or
 * belongs to:
 *
 * - My hours: the caller's own logs, every team.
 * - Money in: for teams whose money the caller runs (owner, or a finance
 *   role of owner/manager/accountant), what the team billed and collected;
 *   for teams where they are only a member, just what was paid to them.
 * - Money out: payouts plus recorded expenses, for the teams they run.
 *
 * Nothing is summed across currencies. Contracts are not listed here — they
 * live in Engagements → Contracts; this page only nudges when one is waiting.
 */
export const Route = createFileRoute("/_execution/engagements/finance/")({
	validateSearch: () => ({}),
	component: MyFinancePage,
});

function formatHours(seconds: number): string {
	return `${(seconds / 3600).toFixed(1)}h`;
}

function MyFinancePage() {
	const summaryQuery = useQuery({
		queryKey: ["finance-books", "me-summary"],
		queryFn: financeBooksService.mySummary,
	});

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-7xl pb-10">
				<FinanceTrail />

				<div className="mt-2">
					<h1 className="text-2xl font-bold tracking-tight text-foreground">
						My finance
					</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Your hours and the money moving in and out, across every team you
						own or belong to. Only you see this page.
					</p>
				</div>

				<SignatureNudge />

				{summaryQuery.isPending ? (
					<FinanceLoading />
				) : summaryQuery.isError ? (
					<AppEmptyState
						icon={CircleDollarSign}
						title="Could not load your finance"
						description={summaryQuery.error.message}
						className="mt-8"
						action={
							<button
								type="button"
								onClick={() => void summaryQuery.refetch()}
								className="app-cta inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
							>
								Try again
							</button>
						}
					/>
				) : (
					<SummaryBody summary={summaryQuery.data} />
				)}
			</div>
		</div>
	);
}

/** Contracts live in Engagements; this is only the doorbell. */
function SignatureNudge() {
	const agreementsQuery = useQuery({
		queryKey: ["engagements", "agreements"],
		queryFn: () => engagementService.agreements(),
	});
	const waiting = (agreementsQuery.data ?? []).filter(
		(agreement) => agreement.status === "sent" && !agreement.signed_at,
	).length;
	if (waiting === 0) return null;
	return (
		<Link
			to="/engagements/contracts"
			search={{ view: "mine" }}
			className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-3.5 transition-colors hover:bg-warning/15"
		>
			<span className="flex items-center gap-3 text-sm font-semibold text-warning-foreground">
				<FileSignature className="h-4 w-4 shrink-0" />
				{waiting === 1
					? "1 contract is waiting for your signature"
					: `${waiting} contracts are waiting for your signature`}
			</span>
			<span className="flex items-center gap-1 text-xs font-semibold text-warning-foreground">
				Open in Engagements <ArrowRight className="h-3.5 w-3.5" />
			</span>
		</Link>
	);
}

function moneyLines(rows: Array<{ currency: string; amount: number }>): string {
	return rows.length
		? rows.map((row) => formatCurrency(row.amount, row.currency)).join("\n")
		: "—";
}

function SummaryBody({ summary }: { summary: MyFinanceSummary }) {
	const { hours, totals, teams } = summary;
	const profile = useProfile();

	const moneyIn = totals.money_in.map((row) => ({
		currency: row.currency,
		amount: row.collected + row.paid_to_me,
	}));
	const invoicedHint = totals.money_in
		.filter((row) => row.invoiced > 0)
		.map(
			(row) =>
				`${formatCurrency(row.invoiced, row.currency)} billed · ${formatCurrency(row.outstanding, row.currency)} open`,
		)
		.join(" · ");
	const moneyOut = totals.money_out.map((row) => ({
		currency: row.currency,
		amount: row.total,
	}));

	return (
		<>
			<div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<StatTile
					label="My hours"
					value={formatHours(hours.month_seconds)}
					hint={`this month · ${formatHours(hours.total_seconds)} all time${
						hours.pending_seconds > 0
							? ` · ${formatHours(hours.pending_seconds)} awaiting approval`
							: ""
					}`}
				/>
				<StatTile
					label="Money in"
					value={moneyLines(moneyIn)}
					hint={invoicedHint || "collected from clients + paid to you"}
					compact={moneyIn.length > 1}
					tone="positive"
				/>
				<StatTile
					label="Money out"
					value={moneyLines(moneyOut)}
					hint="payouts + expenses, teams you run"
					compact={moneyOut.length > 1}
				/>
				<StatTile
					label="Net"
					value={moneyLines(totals.net)}
					hint="money in − money out, per currency"
					compact={totals.net.length > 1}
					tone={
						totals.net.some((row) => row.amount < 0) ? "attention" : undefined
					}
				/>
			</div>

			<section className="mt-8">
				<h2 className="text-base font-semibold text-foreground">By team</h2>
				<p className="mb-3 mt-0.5 text-sm text-muted-foreground">
					Teams you run show their full money in and out. Teams where you are a
					member show only your hours and what they paid you.
				</p>
				{teams.length === 0 ? (
					<AppSurfaceCard className="px-5 py-4 text-sm text-muted-foreground">
						No teams yet. When you create or join one, its money appears here.
					</AppSurfaceCard>
				) : (
					<AppSurfaceCard className="overflow-hidden">
						<div className="hidden grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_24px] gap-4 border-b border-border/60 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground md:grid">
							<span>Team</span>
							<span>My hours (month)</span>
							<span>Money in</span>
							<span>Money out</span>
							<span />
						</div>
						{teams.map((team) => (
							<TeamRow key={team.team_id} team={team} />
						))}
					</AppSurfaceCard>
				)}
			</section>

			<InvoicesToPaySection />

			{isActiveConsultant(profile) ? <ProjectsYouLead /> : null}

			<MyRateCard />
		</>
	);
}

const ROLE_LABEL: Record<string, string> = {
	owner: "Owner",
	admin: "Admin",
	member: "Member",
	manager: "Manager",
	accountant: "Accountant",
};

function TeamRow({ team }: { team: MyFinanceTeam }) {
	const runsMoney = team.scope === "team";
	const roleLabel =
		team.team_role === "member" && team.finance_role
			? ROLE_LABEL[team.finance_role]
			: ROLE_LABEL[team.team_role];
	const moneyIn = runsMoney
		? team.money_in.map((row) => ({
				currency: row.currency,
				amount: row.collected,
			}))
		: team.paid_to_me;
	const moneyOut = team.money_out.map((row) => ({
		currency: row.currency,
		amount: row.total,
	}));

	const content = (
		<>
			<span className="flex min-w-0 items-center gap-3">
				<InitialsTile name={team.team_name} />
				<span className="min-w-0">
					<span className="block truncate text-sm font-semibold text-foreground">
						{team.team_name}
					</span>
					<span className="block truncate text-xs text-muted-foreground">
						{roleLabel ?? "Member"} ·{" "}
						{runsMoney ? "full team finance" : "your share only"}
					</span>
				</span>
			</span>
			<Cell label="My hours (month)">
				{formatHours(team.hours.month_seconds)}
				{team.hours.pending_seconds > 0 ? (
					<span className="block text-[11px] font-normal text-warning-foreground">
						{formatHours(team.hours.pending_seconds)} pending
					</span>
				) : null}
			</Cell>
			<Cell label={runsMoney ? "Collected" : "Paid to you"}>
				{moneyLines(moneyIn)}
			</Cell>
			<Cell label="Money out">{runsMoney ? moneyLines(moneyOut) : "—"}</Cell>
			<span className="hidden items-center justify-end md:flex">
				{runsMoney ? (
					<ChevronRight className="h-4 w-4 text-muted-foreground" />
				) : null}
			</span>
		</>
	);

	const className =
		"grid grid-cols-2 items-center gap-4 border-b border-border/50 px-5 py-4 last:border-b-0 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_24px]";

	// A team whose money you run is a place to go; a membership is a row.
	return runsMoney ? (
		<Link
			to="/engagements/finance/team/$teamId"
			params={{ teamId: team.team_id }}
			className={`${className} transition-colors hover:bg-muted/40`}
		>
			{content}
		</Link>
	) : (
		<div className={className}>{content}</div>
	);
}

function Cell({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<span className="min-w-0">
			<span className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground md:hidden">
				{label}
			</span>
			<span className="block whitespace-pre-line text-sm font-semibold tabular-nums text-foreground">
				{children}
			</span>
		</span>
	);
}

/**
 * The consultant's cross-project rollup (what the old Portfolio page showed).
 * A project opens where its finance lives — its team's project page.
 */
function ProjectsYouLead() {
	const navigate = useNavigate();
	const hubQuery = useFinanceHub();
	const portfolioQuery = useQuery({
		queryKey: ["finance", "portfolio", {}],
		queryFn: () => financeService.portfolio({}),
	});
	if (!portfolioQuery.isPending && !portfolioQuery.data?.projects.length) {
		return null;
	}
	return (
		<section className="mt-8">
			<h2 className="text-base font-semibold text-foreground">
				Projects you lead
			</h2>
			<p className="mb-1 mt-0.5 text-sm text-muted-foreground">
				Revenue, receivables, and margin on the projects you lead as consultant.
			</p>
			<PortfolioOverview
				loading={portfolioQuery.isPending}
				portfolio={portfolioQuery.data}
				onOpen={(projectId) => {
					const home = findProjectHome(hubQuery.data, projectId);
					if (home) {
						void navigate({
							to: "/engagements/finance/team/$teamId/project/$bookId",
							params: home,
							search: { tab: "invoices" },
						});
					} else {
						void navigate({
							to: "/engagements/finance/invoices",
							search: { projectId },
						});
					}
				}}
			/>
		</section>
	);
}

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
	tone?: "attention" | "positive";
	compact?: boolean;
}) {
	return (
		<div className="rounded-2xl border border-border bg-card px-5 py-4">
			<p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
				{label}
			</p>
			<p
				className={`mt-1.5 whitespace-pre-line font-bold tracking-tight ${compact ? "text-base" : "text-2xl"} ${
					tone === "attention"
						? "text-warning-foreground"
						: tone === "positive"
							? "text-success-foreground"
							: "text-foreground"
				}`}
			>
				{value}
			</p>
			<p className="mt-1 text-xs text-muted-foreground">{hint}</p>
		</div>
	);
}
