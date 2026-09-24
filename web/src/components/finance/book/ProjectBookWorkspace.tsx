import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CheckCircle2,
	Clock,
	Download,
	FileSignature,
	FileUp,
	FolderKanban,
	HandCoins,
	Hourglass,
	ReceiptText,
	Settings2,
	TrendingDown,
} from "lucide-react";
import { useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppStatCard,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { AppTabs } from "@/components/common/AppTabs";
import { ExpensesPanel } from "@/components/finance/expenses/ExpensesPanel";
import { ProjectImportsPanel } from "@/components/finance/imports/ProjectImportsPanel";
import { ProjectInvoices } from "@/components/finance/ProjectInvoices";
import {
	FinanceStatusBadge,
	formatFinanceDate,
} from "@/components/finance/portfolio/FinancePrimitives";
import {
	type FinanceBookOverview,
	type FinanceExportFormat,
	type FinanceExportKind,
	financeBooksService,
} from "@/services/financeBooks.service";
import { listTeamProjects } from "@/services/teams.service";

/**
 * The pieces of a finance book that pages compose: the per-project workspace
 * (tabs), the time/payout dashboard, exports, and the team's project list.
 * Extracted from the old `/finance/book/$bookId` page so the team page and the
 * nested project page render them in place — a book is storage, never a
 * place the user navigates to.
 */

// ─── project workspace tabs ───────────────────────────────────────────────

export type ProjectBookTab =
	| "overview"
	| "invoices"
	| "expenses"
	| "imports"
	| "settings";

export const PROJECT_BOOK_TABS: ProjectBookTab[] = [
	"overview",
	"invoices",
	"expenses",
	"imports",
	"settings",
];

const TAB_META: Record<ProjectBookTab, { label: string; icon: typeof Clock }> =
	{
		overview: { label: "Overview", icon: Clock },
		invoices: { label: "Invoices", icon: ReceiptText },
		expenses: { label: "Expenses", icon: TrendingDown },
		imports: { label: "Imports", icon: FileUp },
		settings: { label: "Settings", icon: Settings2 },
	};

/**
 * The per-project financial workspace: everything one contracted project
 * carries, as tabs. Each tab renders the role-sliced payload the overview
 * endpoint already returned — a slice the caller's role may not see is
 * simply absent (and its tab is not drawn), so a client viewer never meets a
 * cost figure whichever tab they open.
 *
 * The contract itself is NOT a tab: contracts live in Engagements, and the
 * overview carries a one-line link to it instead.
 */
export function ProjectBookWorkspace({
	bookId,
	teamId,
	overview,
	tab,
	onTabChange,
	onOpenImport,
}: {
	bookId: string;
	teamId: string;
	overview: FinanceBookOverview;
	tab: ProjectBookTab;
	onTabChange: (tab: ProjectBookTab) => void;
	onOpenImport: (documentId: string) => void;
}) {
	const { book, permissions } = overview;
	const canMoney = Boolean(permissions.manage_money);
	const canExpenses = Boolean(
		permissions.manage_expenses || permissions.view_costs,
	);
	const tabs = PROJECT_BOOK_TABS.filter((id) => {
		if (id === "invoices") return Boolean(permissions.view_contracts);
		if (id === "expenses") return canExpenses;
		if (id === "imports") return canMoney;
		return true;
	});
	const active = tabs.includes(tab) ? tab : "overview";

	return (
		<>
			<AppTabs
				variant="underline"
				size="sm"
				className="mt-5"
				items={tabs.map((id) => {
					const meta = TAB_META[id];
					return {
						key: id,
						label: (
							<>
								<meta.icon className="h-4 w-4" />
								{meta.label}
							</>
						),
					};
				})}
				active={active}
				onChange={(key) => onTabChange(key)}
			/>

			{active === "overview" ? (
				<>
					<ContractLinks overview={overview} />
					<BookTimeSection overview={overview} />
					{permissions.export ? (
						<ExportSection
							bookId={bookId}
							canViewTime={permissions.view_time}
						/>
					) : null}
				</>
			) : null}

			{active === "invoices" ? (
				canMoney && book.project_id ? (
					<div className="mt-6">
						<ProjectInvoices projectId={book.project_id} />
					</div>
				) : (
					<BookInvoicesSection overview={overview} />
				)
			) : null}

			{active === "expenses" ? (
				<div className="mt-6">
					<ExpensesPanel
						teamId={teamId}
						projectId={book.project_id ?? undefined}
					/>
				</div>
			) : null}

			{active === "imports" ? (
				<div className="mt-6">
					<ProjectImportsPanel
						projectId={book.project_id ?? undefined}
						onOpenDocument={onOpenImport}
					/>
				</div>
			) : null}

			{active === "settings" ? (
				<BookSettingsSection overview={overview} />
			) : null}
		</>
	);
}

/**
 * The paper behind this project, as links into Engagements → Contracts —
 * the only place contracts are listed.
 */
function ContractLinks({ overview }: { overview: FinanceBookOverview }) {
	const contracts = overview.contracts ?? [];
	if (contracts.length === 0) return null;
	return (
		<div className="mt-6 flex flex-wrap gap-2">
			{contracts.map((contract) => (
				<Link
					key={contract.id}
					to="/engagements/contracts/$contractId"
					params={{ contractId: contract.id }}
					search={{ section: undefined }}
					className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
				>
					<FileSignature className="h-3.5 w-3.5 text-muted-foreground" />
					Contract {contract.contract_number ?? ""}
					<FinanceStatusBadge status={contract.status} />
					<span className="text-muted-foreground">
						· {contract.billing_mode.replace(/_/g, " ")}
						{contract.signed_at
							? ` · signed ${formatFinanceDate(contract.signed_at.slice(0, 10))}`
							: ""}
					</span>
					<span className="text-primary">View in Engagements →</span>
				</Link>
			))}
		</div>
	);
}

function BookInvoicesSection({ overview }: { overview: FinanceBookOverview }) {
	const invoices = overview.invoices ?? [];
	if (invoices.length === 0) {
		return (
			<AppEmptyState
				icon={ReceiptText}
				title="No invoices yet"
				description="Invoices issued against this project appear here."
				className="mt-6"
			/>
		);
	}
	return (
		<div className="mt-6 space-y-2">
			{invoices.map((invoice) => (
				<AppSurfaceCard
					key={invoice.id}
					className="flex items-center justify-between gap-4 px-5 py-3.5"
				>
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-foreground">
							{invoice.total.toLocaleString()} {invoice.currency}
						</p>
						<p className="text-xs text-muted-foreground">
							{invoice.issued_at
								? `Issued ${formatFinanceDate(invoice.issued_at.slice(0, 10))}`
								: "Not issued yet"}
						</p>
					</div>
					<FinanceStatusBadge status={invoice.status} />
				</AppSurfaceCard>
			))}
		</div>
	);
}

function BookSettingsSection({ overview }: { overview: FinanceBookOverview }) {
	const { book } = overview;
	const rows: Array<{ label: string; value: string }> = [
		{ label: "Display currency", value: book.currency },
		{
			label: "Status",
			value:
				book.status === "archived"
					? "Archived — client contract ended"
					: "Active",
		},
		{ label: "Team", value: overview.team_name ?? "—" },
		{ label: "Project", value: overview.project_title ?? "—" },
	];
	return (
		<AppSurfaceCard className="mt-6 divide-y divide-border/60">
			{rows.map((row) => (
				<div
					key={row.label}
					className="flex items-center justify-between gap-4 px-5 py-3.5"
				>
					<p className="text-sm text-muted-foreground">{row.label}</p>
					<p className="text-sm font-semibold text-foreground">{row.value}</p>
				</div>
			))}
			<div className="px-5 py-3.5">
				<p className="text-xs text-muted-foreground">
					A project book opens when its client contract is signed and archives
					when that contract ends. Members and roles are managed from the Share
					dialog; revenue split and cost settings live in the consultant&apos;s
					project financials.
				</p>
			</div>
		</AppSurfaceCard>
	);
}

// ─── dashboard (role-sliced: keys absent from the payload never render) ───

function formatBookHours(seconds: number): string {
	return `${(seconds / 3600).toFixed(1)}h`;
}

export function BookTimeSection({
	overview,
}: {
	overview: FinanceBookOverview;
}) {
	const { time, payouts } = overview;

	return (
		<>
			{time ? (
				<>
					<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						<AppStatCard
							label="Total hours"
							value={formatBookHours(time.total_seconds)}
							icon={Clock}
						/>
						<AppStatCard
							label="Pending"
							value={formatBookHours(time.pending_seconds)}
							icon={Hourglass}
						/>
						<AppStatCard
							label="Approved"
							value={formatBookHours(time.approved_seconds)}
							icon={CheckCircle2}
						/>
					</div>

					{payouts && payouts.length > 0 ? (
						<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{payouts.map((entry) => (
								<AppStatCard
									key={entry.currency}
									label={`Payouts · ${entry.currency} · ${entry.count}`}
									value={`${entry.total.toLocaleString()} ${entry.currency}`}
									icon={HandCoins}
								/>
							))}
						</div>
					) : null}

					{time.by_member.length > 0 ? (
						<>
							<AppSectionHeader
								title="By member"
								subtitle="Logged time per member in this book."
								className="mt-8"
							/>
							<AppSurfaceCard className="mt-3 divide-y divide-slate-100">
								{time.by_member.map((member) => (
									<div
										key={member.user_id}
										className="flex items-center justify-between gap-4 px-5 py-3"
									>
										<p className="truncate text-sm font-medium text-slate-900">
											{member.display_name}
										</p>
										<p className="shrink-0 text-sm text-slate-600 tabular-nums">
											{formatBookHours(member.seconds)}
											{/* Amounts come pre-computed from the server for roles
											    allowed to see costs — never derived client-side. */}
											{member.amount != null && member.currency
												? ` · ${member.amount.toLocaleString()} ${member.currency}`
												: ""}
										</p>
									</div>
								))}
							</AppSurfaceCard>
						</>
					) : null}
				</>
			) : null}
		</>
	);
}

// ─── exports ──────────────────────────────────────────────────────────────

const FORMAT_OPTIONS: Array<{ value: FinanceExportFormat; label: string }> = [
	{ value: "csv", label: "CSV" },
	{ value: "xlsx", label: "Excel" },
	{ value: "pdf", label: "PDF" },
];

export function ExportSection({
	bookId,
	canViewTime,
}: {
	bookId: string;
	canViewTime: boolean;
}) {
	const [format, setFormat] = useState<FinanceExportFormat>("csv");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<FinanceExportKind | null>(null);

	const run = async (kind: FinanceExportKind) => {
		setError(null);
		setBusy(kind);
		try {
			await financeBooksService.downloadExport(bookId, kind, format);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(null);
		}
	};

	return (
		<>
			<AppSectionHeader
				title="Export"
				subtitle="Download this book's records. Cost columns appear only for roles that can see costs."
				className="mt-8"
			/>
			<AppSurfaceCard className="mt-3 flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
				<select
					value={format}
					onChange={(event) =>
						setFormat(event.target.value as FinanceExportFormat)
					}
					className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 sm:w-32"
				>
					{FORMAT_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
				{canViewTime ? (
					<button
						type="button"
						disabled={busy !== null}
						onClick={() => run("time_logs")}
						className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
					>
						<Download className="h-4 w-4" />
						{busy === "time_logs" ? "Exporting…" : "Export time logs"}
					</button>
				) : null}
				<button
					type="button"
					disabled={busy !== null}
					onClick={() => run("payouts")}
					className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 disabled:opacity-60"
				>
					<Download className="h-4 w-4" />
					{busy === "payouts" ? "Exporting…" : "Export payouts"}
				</button>
			</AppSurfaceCard>
			{error ? (
				<p className="mt-2 text-sm font-medium text-red-600">{error}</p>
			) : null}
		</>
	);
}

// ─── child project books (team books only) ────────────────────────────────

/**
 * "Add a project" for a team: pick one of the team's attached projects with a
 * signed client contract to open its project finance. The list of existing
 * project finance renders separately (from the hub), so this is just the
 * control, shown only to those who can manage the team book.
 */
export function ProjectBooksSection({
	bookId,
	teamId,
	canManageBook,
	existingProjectIds,
}: {
	bookId: string;
	teamId: string;
	canManageBook: boolean;
	existingProjectIds: string[];
}) {
	const queryClient = useQueryClient();
	const [projectId, setProjectId] = useState("");

	const teamProjectsQuery = useQuery({
		queryKey: ["teams", teamId, "projects"],
		queryFn: () => listTeamProjects(teamId),
		enabled: canManageBook,
	});
	const existing = new Set(existingProjectIds);
	const candidates = (teamProjectsQuery.data ?? []).filter(
		(attachment) => !existing.has(attachment.project_id),
	);

	const addMutation = useMutation({
		mutationFn: () => financeBooksService.addProject(bookId, projectId),
		onSuccess: async () => {
			setProjectId("");
			await queryClient.invalidateQueries({ queryKey: ["finance-books"] });
		},
	});

	if (!canManageBook || candidates.length === 0) return null;

	return (
		<>
			<div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
				<select
					value={projectId}
					onChange={(event) => setProjectId(event.target.value)}
					className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground sm:max-w-sm"
				>
					<option value="">Add a project's finance…</option>
					{candidates.map((attachment) => (
						<option key={attachment.project_id} value={attachment.project_id}>
							{attachment.project?.title ?? "Untitled project"}
						</option>
					))}
				</select>
				<button
					type="button"
					disabled={!projectId || addMutation.isPending}
					onClick={() => addMutation.mutate()}
					className="app-cta inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
				>
					<FolderKanban className="h-4 w-4" />
					{addMutation.isPending ? "Adding…" : "Add project"}
				</button>
			</div>
			{addMutation.isError ? (
				<p className="mt-2 text-sm font-medium text-destructive">
					{addMutation.error.message}
				</p>
			) : null}
		</>
	);
}
