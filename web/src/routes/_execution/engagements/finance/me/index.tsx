import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	CircleDollarSign,
	Clock,
	Download,
	FolderKanban,
	HandCoins,
	Hourglass,
	ReceiptText,
	Users,
	Wallet,
} from "lucide-react";
import { useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import {
	AppEmptyState,
	AppSectionHeader,
	AppStatCard,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { AgreementRow } from "@/components/engagements/AgreementRow";
import {
	FINANCE_CRUMB_LINK_CLASS,
	FinanceBreadcrumbs,
	FinanceCurrentCrumb,
} from "@/components/finance/portfolio/FinanceBreadcrumbs";
import {
	FinanceLoading,
	FinanceStatusBadge,
} from "@/components/finance/portfolio/FinancePrimitives";
import { InvoicePreview } from "@/components/invoices/InvoicePreview";
import { engagementService } from "@/services/engagement.service";
import {
	type FinanceHubTeam,
	financeBooksService,
} from "@/services/financeBooks.service";
import {
	invoiceService,
	type ReceivedInvoiceSummary,
} from "@/services/invoice.service";
import { profileService } from "@/services/profile.service";
import { useProfile } from "@/stores/authStore";

/**
 * The personal finance (F1) dashboard: hours worked, payouts received, and
 * the caller's teams with their finance books. Available to every execution
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

				{/*
				 * A failed listMine must read as an outage, not as "you have no
				 * book" — showing the create CTA on error walked users into a 409.
				 */}
				{booksQuery.isError ? (
					<div className="mt-8">
						<AppEmptyState
							icon={CircleDollarSign}
							title="Could not load your finance"
							description={booksQuery.error.message}
							action={
								<button
									type="button"
									onClick={() => void booksQuery.refetch()}
									className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
								>
									Try again
								</button>
							}
						/>
					</div>
				) : !personalBook ? (
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

	const hubQuery = useQuery({
		queryKey: ["finance-books", "hub"],
		queryFn: financeBooksService.hub,
	});
	const teams = hubQuery.data?.teams ?? [];

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

			<MyRateCard />

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

			<InvoicesToPaySection />

			<MyContractsSection />

			<AppSectionHeader
				title="My teams"
				subtitle="Your teams and the finance books behind them — signed contracts unlock the timer and payouts per project."
				className="mt-8"
			/>
			{hubQuery.isPending ? (
				<p className="mt-3 text-sm text-slate-500">Loading your teams…</p>
			) : teams.length === 0 ? (
				<AppEmptyState
					icon={Users}
					title="No teams yet"
					description="When you join or create a team, its projects and finance books appear here. Signed contracts unlock the execution timer and payouts."
					className="mt-3"
				/>
			) : (
				<div className="mt-3 space-y-3">
					{teams.map((team) => (
						<MyTeamBlock
							key={team.team_id}
							team={team}
							engagedProjects={engaged_projects}
						/>
					))}
				</div>
			)}
		</>
	);
}

function MyTeamBlock({
	team,
	engagedProjects,
}: {
	team: FinanceHubTeam;
	engagedProjects: NonNullable<
		Awaited<ReturnType<typeof financeBooksService.personalDashboard>>
	>["engaged_projects"];
}) {
	const isOwner = team.my_team_role === "owner";

	return (
		<AppSurfaceCard className="p-5">
			<div className="flex items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-3">
					{team.avatar_url ? (
						<img
							src={team.avatar_url}
							alt=""
							className="h-9 w-9 shrink-0 rounded-lg object-cover"
						/>
					) : (
						<span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
							<Users className="h-4 w-4" />
						</span>
					)}
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-slate-900">
							{team.team_name}
						</p>
						<p className="text-xs text-slate-500 capitalize">
							{team.my_team_role.replace(/_/g, " ")}
						</p>
					</div>
				</div>
				{isOwner ? (
					<div className="flex shrink-0 items-center gap-2">
						{team.book ? (
							<Link
								to="/engagements/finance/book/$bookId"
								params={{ bookId: team.book.id }}
								className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-900 hover:text-slate-900"
							>
								Team finance
							</Link>
						) : null}
						<Link
							to="/engagements/finance/team/$teamId/addons"
							params={{ teamId: team.team_id }}
							className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-900 hover:text-slate-900"
						>
							Add-ons
						</Link>
					</div>
				) : null}
			</div>

			{team.project_books.length > 0 ? (
				<div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
					{team.project_books.map((entry) => (
						<Link
							key={entry.book.id}
							to="/engagements/finance/book/$bookId"
							params={{ bookId: entry.book.id }}
							className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50"
						>
							<span className="flex min-w-0 items-center gap-2">
								<FolderKanban className="h-4 w-4 shrink-0 text-slate-400" />
								<span className="truncate text-sm font-medium text-slate-800">
									{entry.project_title}
								</span>
							</span>
							<FinanceStatusBadge status={entry.contract_status} />
						</Link>
					))}
				</div>
			) : engagedProjects.length > 0 ? (
				// No project books yet — fall back to the caller's engaged
				// contracts so the block still shows where their time can go.
				<div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
					{engagedProjects.map((project) => (
						<div
							key={project.contract_id}
							className="flex items-center justify-between gap-3 px-2 py-2"
						>
							<span className="truncate text-sm font-medium text-slate-800">
								{project.project_title}
							</span>
							<FinanceStatusBadge status={project.contract_status} />
						</div>
					))}
				</div>
			) : null}
		</AppSurfaceCard>
	);
}

/**
 * Every agreement the caller is a party to, in any seat. The same partition
 * rules as the engagement list apply on the row itself: a `sent` contract the
 * viewer has not signed opens on its signatures section.
 */
function MyContractsSection() {
	const navigate = useNavigate();
	const agreementsQuery = useQuery({
		queryKey: ["engagements", "agreements"],
		queryFn: () => engagementService.agreements(),
	});
	const agreements = agreementsQuery.data ?? [];

	return (
		<>
			<AppSectionHeader
				title="My contracts"
				subtitle="Every agreement you are a party to. Your seat on each contract decides what it shows you."
				className="mt-8"
			/>
			{agreementsQuery.isPending ? (
				<p className="mt-3 text-sm text-muted-foreground">Loading…</p>
			) : agreements.length === 0 ? (
				<AppEmptyState
					icon={CircleDollarSign}
					title="No contracts yet"
					description="When you sign a contract — as a client, consultant, or talent — it appears here."
					className="mt-3"
				/>
			) : (
				<AppSurfaceCard className="mt-3 divide-y divide-border overflow-hidden">
					{agreements.map((agreement) => (
						<AgreementRow
							key={agreement.contract_id}
							agreement={agreement}
							onOpen={(contractId, section) =>
								void navigate({
									to: "/engagements/finance/$contractId",
									params: { contractId },
									search: { section },
								})
							}
						/>
					))}
				</AppSurfaceCard>
			)}
		</>
	);
}

/**
 * The caller's marketplace rate card, when they keep one. A client account
 * has no rate settings and simply does not meet this card.
 */
function MyRateCard() {
	const profile = useProfile();
	const fullProfileQuery = useQuery({
		queryKey: ["profile", "full", profile?.id],
		queryFn: () => profileService.getProfile(profile?.id as string),
		enabled: Boolean(profile?.id),
		staleTime: 60_000,
	});
	const rate = fullProfileQuery.data?.rate_settings;
	if (!rate || rate.hourly_rate == null) return null;

	return (
		<AppSurfaceCard className="mt-6 flex flex-wrap items-center justify-between gap-4 px-5 py-4">
			<div className="flex min-w-0 items-center gap-3">
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
					<HandCoins className="h-5 w-5" />
				</span>
				<div className="min-w-0">
					<p className="text-sm font-semibold text-foreground">
						Default rate · {rate.hourly_rate.toLocaleString()} {rate.currency}
						/hr
					</p>
					<p className="text-xs text-muted-foreground">
						Shown on your marketplace profile
						{rate.availability
							? ` · ${rate.availability.replace(/_/g, " ")}`
							: ""}
					</p>
				</div>
			</div>
			<Link
				to="/profile/$profileId"
				params={{ profileId: profile?.id as string }}
				className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
			>
				Edit
			</Link>
		</AppSurfaceCard>
	);
}

/**
 * Money out — every invoice billed TO the caller. The payer's side of the
 * ledger, which used to reach them only as email. A row opens the same
 * document facsimile the issuer works against, plus the PDF when one exists.
 */
function InvoicesToPaySection() {
	const [openInvoice, setOpenInvoice] = useState<ReceivedInvoiceSummary | null>(
		null,
	);
	const receivedQuery = useQuery({
		queryKey: ["invoices", "received"],
		queryFn: () => invoiceService.listReceived(),
	});
	const items = receivedQuery.data ?? [];
	if (items.length === 0) return null;

	const outstanding = items.reduce(
		(sum, invoice) => sum + invoice.balance_due,
		0,
	);
	const currency = items[0]?.currency ?? "";
	const overdueCount = items.filter((invoice) => invoice.is_overdue).length;

	return (
		<>
			<AppSectionHeader
				title="Invoices to pay"
				subtitle={
					outstanding > 0
						? `${outstanding.toLocaleString()} ${currency} outstanding${overdueCount > 0 ? ` · ${overdueCount} past due` : ""}.`
						: "Everything billed to you is settled."
				}
				className="mt-8"
			/>
			<AppSurfaceCard className="mt-3 divide-y divide-border overflow-hidden">
				{items.map((invoice) => (
					<button
						key={invoice.id}
						type="button"
						onClick={() => setOpenInvoice(invoice)}
						className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 md:px-5"
					>
						<span className="flex min-w-0 items-center gap-3">
							<span
								className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
									invoice.is_overdue
										? "bg-destructive/10 text-destructive"
										: "bg-muted text-muted-foreground"
								}`}
							>
								<ReceiptText className="h-5 w-5" />
							</span>
							<span className="min-w-0">
								<span className="block truncate text-sm font-semibold text-foreground">
									{invoice.number} · {invoice.total.toLocaleString()}{" "}
									{invoice.currency}
								</span>
								<span className="mt-0.5 block truncate text-xs text-muted-foreground">
									{invoice.issued_by_name ?? "—"}
									{invoice.project_title ? ` · ${invoice.project_title}` : ""}
									{invoice.is_overdue
										? ` · ${invoice.days_overdue} days late`
										: invoice.due_date
											? ` · due ${new Date(`${invoice.due_date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
											: ""}
									{invoice.balance_due > 0 && invoice.amount_paid > 0
										? ` · ${invoice.balance_due.toLocaleString()} ${invoice.currency} open`
										: ""}
								</span>
							</span>
						</span>
						<FinanceStatusBadge
							status={invoice.is_overdue ? "overdue" : invoice.status}
							className="shrink-0"
						/>
					</button>
				))}
			</AppSurfaceCard>

			<ReceivedInvoiceDialog
				invoice={openInvoice}
				onClose={() => setOpenInvoice(null)}
			/>
		</>
	);
}

function ReceivedInvoiceDialog({
	invoice,
	onClose,
}: {
	invoice: ReceivedInvoiceSummary | null;
	onClose: () => void;
}) {
	const detailQuery = useQuery({
		queryKey: ["invoices", "received", invoice?.id],
		queryFn: () => invoiceService.getReceived(invoice?.id as string),
		enabled: Boolean(invoice),
	});
	const [pdfBusy, setPdfBusy] = useState(false);
	const detail = detailQuery.data;

	const openPdf = async () => {
		if (!invoice) return;
		setPdfBusy(true);
		try {
			const { url } = await invoiceService.getPdfUrl(invoice.id);
			window.open(url, "_blank", "noopener");
		} finally {
			setPdfBusy(false);
		}
	};

	return (
		<AppDialog
			open={Boolean(invoice)}
			onClose={onClose}
			title={invoice ? `Invoice ${invoice.number}` : ""}
			size="lg"
			footer={
				<div className="flex w-full items-center justify-between gap-4">
					<span className="text-xs text-muted-foreground">
						Questions about this invoice go to the consultant who issued it.
					</span>
					<div className="flex items-center gap-2">
						{invoice?.has_pdf && (
							<button
								type="button"
								disabled={pdfBusy}
								onClick={() => void openPdf()}
								className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
							>
								<Download className="h-4 w-4" />
								{pdfBusy ? "Opening…" : "PDF"}
							</button>
						)}
						<button
							type="button"
							onClick={onClose}
							className="app-cta inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-white"
						>
							Done
						</button>
					</div>
				</div>
			}
		>
			{detailQuery.isPending ? (
				<FinanceLoading />
			) : detailQuery.isError || !detail ? (
				<p className="py-6 text-sm text-muted-foreground">
					Could not load this invoice.
				</p>
			) : (
				<div className="max-h-[60vh] overflow-y-auto rounded-xl border border-border">
					<InvoicePreview
						number={detail.number}
						currency={detail.currency}
						issueDate={detail.issue_date}
						dueDate={detail.due_date}
						periodStart={detail.period_start}
						periodEnd={detail.period_end}
						issuedBy={detail.issued_by}
						billTo={detail.bill_to}
						paymentMethod={detail.payment_method}
						notes={detail.notes}
						lines={detail.line_items.map((line) => ({
							description: line.description,
							quantity: line.quantity,
							unit_rate: line.unit_rate,
							isHours: line.is_hours,
						}))}
						status={detail.status}
						amountPaid={detail.amount_paid}
						isOverdue={detail.is_overdue}
					/>
				</div>
			)}
		</AppDialog>
	);
}
