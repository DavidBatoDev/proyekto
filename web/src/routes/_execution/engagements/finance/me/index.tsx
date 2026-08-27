import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	CircleDollarSign,
	Clock,
	FileSignature,
	HandCoins,
	Hourglass,
	Wallet,
} from "lucide-react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppStatCard,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import {
	FINANCE_CRUMB_LINK_CLASS,
	FinanceBreadcrumbs,
	FinanceCurrentCrumb,
} from "@/components/finance/portfolio/FinanceBreadcrumbs";
import { FinanceLoading } from "@/components/finance/portfolio/FinancePrimitives";
import { financeBooksService } from "@/services/financeBooks.service";

/**
 * The personal finance (F1) dashboard: hours worked, payouts received, and
 * the projects the user is contract-engaged on. Available to every execution
 * user once they create their book; a zero-contract book renders empty
 * states — contracts unlock data, never creation.
 */
export const Route = createFileRoute("/_execution/engagements/finance/me/")({
	component: PersonalFinancePage,
});

function formatHours(seconds: number): string {
	return `${(seconds / 3600).toFixed(1)}h`;
}

function PersonalFinancePage() {
	const booksQuery = useQuery({
		queryKey: ["finance-books", "mine"],
		queryFn: financeBooksService.listMine,
	});
	const personalBook = booksQuery.data?.find(
		(book) => book.kind === "personal",
	);

	const dashboardQuery = useQuery({
		queryKey: ["finance-books", "personal-dashboard"],
		queryFn: financeBooksService.personalDashboard,
		enabled: Boolean(personalBook),
	});

	if (booksQuery.isPending) return <FinanceLoading />;

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-6xl">
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
						<FinanceCurrentCrumb key="me">My finance</FinanceCurrentCrumb>,
					]}
				/>

				{!personalBook ? (
					<div className="mt-8">
						<AppEmptyState
							icon={CircleDollarSign}
							title="Create your personal finance"
							description="Your private view of hours worked, payouts, and rates across your engaged projects. Anyone can create one — a signed contract is what unlocks the timer and payout data."
							action={
								<Link
									to="/engagements/finance/setup/personal"
									className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
								>
									Set up my finance
								</Link>
							}
						/>
					</div>
				) : dashboardQuery.isPending ? (
					<FinanceLoading />
				) : dashboardQuery.isError ? (
					<div className="mt-8">
						<AppEmptyState
							icon={CircleDollarSign}
							title="Could not load your finance"
							description={dashboardQuery.error.message}
						/>
					</div>
				) : (
					<PersonalDashboardBody
						dashboard={dashboardQuery.data}
						currency={personalBook.currency}
					/>
				)}
			</div>
		</div>
	);
}

function PersonalDashboardBody({
	dashboard,
	currency,
}: {
	dashboard: NonNullable<
		Awaited<ReturnType<typeof financeBooksService.personalDashboard>>
	>;
	currency: string;
}) {
	const { hours, payouts_in, engaged_projects } = dashboard;
	const hasContracts = engaged_projects.length > 0;

	return (
		<>
			<AppSectionHeader
				title="My finance"
				subtitle={`Your private book — hours, payouts, and engaged projects. Display currency ${currency}.`}
				className="mt-4"
			/>

			<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<AppStatCard
					label="Hours worked"
					value={formatHours(hours.total_seconds)}
					icon={Clock}
				/>
				<AppStatCard
					label="This month"
					value={formatHours(hours.month_seconds)}
					icon={Hourglass}
				/>
				<AppStatCard
					label="Awaiting approval"
					value={formatHours(hours.pending_seconds)}
					icon={Hourglass}
				/>
			</div>

			<AppSectionHeader
				title="Money in"
				subtitle="Recorded payouts, grouped by currency."
				className="mt-8"
			/>
			{payouts_in.length === 0 ? (
				<AppEmptyState
					icon={Wallet}
					title="No payouts yet"
					description={
						hasContracts
							? "Payouts recorded by your teams will appear here."
							: "Payouts arrive through engaged projects. Once a contract with a team is signed, your payouts will land here."
					}
					className="mt-3"
				/>
			) : (
				<div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{payouts_in.map((entry) => (
						<AppStatCard
							key={entry.currency}
							label={`${entry.currency} · ${entry.count} payout${entry.count === 1 ? "" : "s"}`}
							value={`${entry.total.toLocaleString()} ${entry.currency}`}
							icon={HandCoins}
						/>
					))}
				</div>
			)}

			<AppSectionHeader
				title="Engaged projects"
				subtitle="Projects where you hold a signed seat on a live contract — these unlock the timer and payouts."
				className="mt-8"
			/>
			{!hasContracts ? (
				<AppEmptyState
					icon={FileSignature}
					title="No engaged projects yet"
					description="You are not on a signed contract yet. When a team signs one with you, the project appears here and the execution timer unlocks for it."
					className="mt-3"
				/>
			) : (
				<div className="mt-3 space-y-3">
					{engaged_projects.map((project) => (
						<AppSurfaceCard
							key={project.contract_id}
							className="flex items-center justify-between gap-4 px-5 py-4"
						>
							<div className="min-w-0">
								<p className="truncate text-sm font-semibold text-slate-900">
									{project.project_title}
								</p>
								<p className="text-xs text-slate-500">
									{project.relationship_kind === "talent_services"
										? "Talent contract"
										: "Client contract"}{" "}
									· {project.currency}
								</p>
							</div>
							<span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 capitalize">
								{project.contract_status}
							</span>
						</AppSurfaceCard>
					))}
				</div>
			)}
		</>
	);
}
