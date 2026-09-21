import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Archive,
	BookOpen,
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
	Share2,
} from "lucide-react";
import { useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppStatCard,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { AppTabs } from "@/components/common/AppTabs";
import { FinanceShareDialog } from "@/components/finance/FinanceShareDialog";
import {
	FINANCE_CRUMB_LINK_CLASS,
	FinanceBreadcrumbs,
	FinanceCurrentCrumb,
} from "@/components/finance/portfolio/FinanceBreadcrumbs";
import {
	FinanceLoading,
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
 * The finance-book overview: header, members (with inherited F2 grants),
 * invites, and — for team books — the child project books. What renders is
 * driven by the caller's resolved permissions; anything cost-flavored stays
 * off this page entirely, so a viewer_client can never meet a cost figure.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/book/$bookId/",
)({
	component: FinanceBookPage,
});

const ROLE_LABELS: Record<string, string> = {
	owner: "Owner",
	manager: "Manager",
	accountant: "Accountant",
	viewer_client: "Client viewer",
	viewer: "Viewer",
};

function FinanceBookPage() {
	const { bookId } = Route.useParams();

	// The overview endpoint supersedes the bare `get`: same access envelope,
	// plus the names (team/project/parent) the breadcrumbs and heading need
	// and the dashboard slices (time/payouts/contracts/invoices) the caller's
	// role is allowed to see.
	const overviewQuery = useQuery({
		queryKey: ["finance-books", bookId, "overview"],
		queryFn: () => financeBooksService.overview(bookId),
	});

	if (overviewQuery.isPending) return <FinanceLoading />;

	const overview = overviewQuery.data;
	const crumbLabel = overview
		? overview.book.kind === "project"
			? (overview.project_title ?? "Project")
			: overview.book.kind === "team"
				? (overview.team_name ?? "Team")
				: "My finance"
		: "Book";

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-4xl">
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
						// An F3 crumb trail routes through its parent F2 book.
						...(overview?.book.kind === "project" && overview.parent_book_id
							? [
									<Link
										key="team"
										to="/engagements/finance/book/$bookId"
										params={{ bookId: overview.parent_book_id }}
										className={FINANCE_CRUMB_LINK_CLASS}
									>
										{overview.team_name ?? "Team"}
									</Link>,
								]
							: []),
						<FinanceCurrentCrumb key="book">{crumbLabel}</FinanceCurrentCrumb>,
					]}
				/>

				{overviewQuery.isError || !overview ? (
					<div className="mt-8">
						<AppEmptyState
							icon={BookOpen}
							title="Finance book not found"
							description={
								overviewQuery.error?.message ?? "This book could not be loaded."
							}
						/>
					</div>
				) : (
					<BookBody bookId={bookId} overview={overview} />
				)}
			</div>
		</div>
	);
}

function BookBody({
	bookId,
	overview,
}: {
	bookId: string;
	overview: FinanceBookOverview;
}) {
	const { book, role, permissions } = overview;
	const kindLabel =
		book.kind === "personal"
			? "Personal finance"
			: book.kind === "team"
				? "Team finance"
				: "Project finance";
	const title =
		book.kind === "project"
			? (overview.project_title ?? kindLabel)
			: book.kind === "team"
				? (overview.team_name ?? kindLabel)
				: kindLabel;

	const [shareOpen, setShareOpen] = useState(false);

	return (
		<>
			<div className="mt-4 flex flex-wrap items-start justify-between gap-4">
				<AppSectionHeader
					title={title}
					kicker={title === kindLabel ? undefined : kindLabel}
					subtitle={`Display currency ${book.currency} · your role: ${ROLE_LABELS[role] ?? role}${overview.inherited ? " (inherited from the team book)" : ""}.`}
				/>
				{book.kind !== "personal" ? (
					<button
						type="button"
						onClick={() => setShareOpen(true)}
						className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
					>
						<Share2 className="h-4 w-4" />
						Share
					</button>
				) : null}
			</div>

			{book.status === "archived" ? (
				<div className="mt-4 flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-3.5">
					<Archive className="h-4 w-4 shrink-0 text-warning-foreground" />
					<p className="text-sm text-warning-foreground">
						This book is archived — its client contract ended. History stays
						readable and exportable, but nothing new is recorded.
					</p>
				</div>
			) : null}

			{book.kind === "project" ? (
				<ProjectBookTabs bookId={bookId} overview={overview} />
			) : (
				<>
					<BookDashboard overview={overview} />

					{permissions.export ? (
						<ExportSection
							bookId={bookId}
							canViewTime={permissions.view_time}
						/>
					) : null}

					{book.kind === "team" ? (
						<ProjectBooksSection
							bookId={bookId}
							teamId={book.owner_team_id}
							canManageBook={permissions.manage_book}
						/>
					) : null}
				</>
			)}

			{book.kind !== "personal" ? (
				<FinanceShareDialog
					bookId={bookId}
					bookTitle={title}
					canManage={permissions.manage_members}
					open={shareOpen}
					onClose={() => setShareOpen(false)}
				/>
			) : null}
		</>
	);
}

// ─── project workspace tabs ───────────────────────────────────────────────

type ProjectBookTab =
	| "overview"
	| "contract"
	| "invoices"
	| "imports"
	| "settings";

const PROJECT_BOOK_TABS: Array<{
	id: ProjectBookTab;
	label: string;
	icon: typeof Clock;
}> = [
	{ id: "overview", label: "Overview", icon: Clock },
	{ id: "contract", label: "Contract", icon: FileSignature },
	{ id: "invoices", label: "Invoices", icon: ReceiptText },
	{ id: "imports", label: "Imports", icon: FileUp },
	{ id: "settings", label: "Settings", icon: Settings2 },
];

/**
 * The per-project financial workspace: everything one contracted project
 * carries, as tabs. Each tab renders the role-sliced payload the overview
 * endpoint already returned — a slice the caller's role may not see is
 * simply absent, so a client viewer never meets a cost figure whichever tab
 * they open.
 */
function ProjectBookTabs({
	bookId,
	overview,
}: {
	bookId: string;
	overview: FinanceBookOverview;
}) {
	const [tab, setTab] = useState<ProjectBookTab>("overview");
	const { book, permissions } = overview;

	return (
		<>
			<AppTabs
				variant="underline"
				size="sm"
				className="mt-5"
				items={PROJECT_BOOK_TABS.map((entry) => ({
					key: entry.id,
					label: (
						<>
							<entry.icon className="h-4 w-4" />
							{entry.label}
						</>
					),
				}))}
				active={tab}
				onChange={(key) => setTab(key)}
			/>

			{tab === "overview" ? (
				<>
					<BookTimeSection overview={overview} />
					{permissions.export ? (
						<ExportSection
							bookId={bookId}
							canViewTime={permissions.view_time}
						/>
					) : null}
				</>
			) : null}

			{tab === "contract" ? <BookContractsSection overview={overview} /> : null}

			{tab === "invoices" ? <BookInvoicesSection overview={overview} /> : null}

			{tab === "imports" ? (
				<AppSurfaceCard className="mt-6 flex flex-wrap items-center justify-between gap-4 px-5 py-4">
					<div className="min-w-0">
						<p className="text-sm font-semibold text-foreground">
							Imported documents
						</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Record invoices and payments issued outside Proyekto against this
							project&apos;s ledger, with the source document as evidence.
						</p>
					</div>
					{book.project_id ? (
						<Link
							to="/engagements/finance/imports"
							search={{ projectId: book.project_id }}
							className="app-cta inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
						>
							<FileUp className="h-4 w-4" />
							Open imports
						</Link>
					) : null}
				</AppSurfaceCard>
			) : null}

			{tab === "settings" ? <BookSettingsSection overview={overview} /> : null}
		</>
	);
}

function BookContractsSection({ overview }: { overview: FinanceBookOverview }) {
	const contracts = overview.contracts ?? [];
	if (contracts.length === 0) {
		return (
			<AppEmptyState
				icon={FileSignature}
				title="No contracts on this project"
				description="Signed client contracts on this project appear here."
				className="mt-6"
			/>
		);
	}
	return (
		<div className="mt-6 space-y-2">
			{contracts.map((contract) => (
				<AppSurfaceCard
					key={contract.id}
					className="flex items-center justify-between gap-4 px-5 py-3.5"
				>
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-foreground">
							{contract.contract_number ?? "Contract"}
						</p>
						<p className="text-xs text-muted-foreground capitalize">
							{contract.billing_mode.replace(/_/g, " ")}
							{contract.client_hourly_rate != null
								? ` · ${contract.client_hourly_rate.toLocaleString()} ${contract.currency}/h`
								: ""}
							{contract.signed_at
								? ` · signed ${formatFinanceDate(contract.signed_at.slice(0, 10))}`
								: ""}
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<FinanceStatusBadge status={contract.status} />
						<Link
							to="/engagements/finance/$contractId"
							params={{ contractId: contract.id }}
							search={{ section: undefined }}
							className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
						>
							Open
						</Link>
					</div>
				</AppSurfaceCard>
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

function BookDashboard({ overview }: { overview: FinanceBookOverview }) {
	return (
		<>
			<BookTimeSection overview={overview} />
			<BookLedgerSections overview={overview} />
		</>
	);
}

function BookTimeSection({ overview }: { overview: FinanceBookOverview }) {
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

function BookLedgerSections({ overview }: { overview: FinanceBookOverview }) {
	const { contracts, invoices } = overview;
	return (
		<>
			{contracts ? (
				<>
					<AppSectionHeader
						title="Contracts"
						subtitle="Client contracts attached to this book."
						className="mt-8"
					/>
					{contracts.length === 0 ? (
						<AppEmptyState
							icon={FileSignature}
							title="No contracts yet"
							description="Signed client contracts on this book will appear here."
							className="mt-3"
						/>
					) : (
						<div className="mt-3 space-y-2">
							{contracts.map((contract) => (
								<AppSurfaceCard
									key={contract.id}
									className="flex items-center justify-between gap-4 px-5 py-3.5"
								>
									<div className="min-w-0">
										<p className="truncate text-sm font-semibold text-slate-900">
											{contract.contract_number}
										</p>
										<p className="text-xs text-slate-500 capitalize">
											{contract.billing_mode.replace(/_/g, " ")}
											{contract.client_hourly_rate != null
												? ` · ${contract.client_hourly_rate.toLocaleString()} ${contract.currency}/h`
												: ""}
											{contract.signed_at
												? ` · signed ${formatFinanceDate(contract.signed_at.slice(0, 10))}`
												: ""}
										</p>
									</div>
									<FinanceStatusBadge status={contract.status} />
								</AppSurfaceCard>
							))}
						</div>
					)}
				</>
			) : null}

			{invoices ? (
				<>
					<AppSectionHeader
						title="Invoices"
						subtitle="Invoices issued against this book."
						className="mt-8"
					/>
					{invoices.length === 0 ? (
						<AppEmptyState
							icon={ReceiptText}
							title="No invoices yet"
							description="Invoices issued against this book will appear here."
							className="mt-3"
						/>
					) : (
						<div className="mt-3 space-y-2">
							{invoices.map((invoice) => (
								<AppSurfaceCard
									key={invoice.id}
									className="flex items-center justify-between gap-4 px-5 py-3.5"
								>
									<div className="min-w-0">
										<p className="truncate text-sm font-semibold text-slate-900">
											{invoice.total.toLocaleString()} {invoice.currency}
										</p>
										<p className="text-xs text-slate-500">
											{invoice.issued_at
												? `Issued ${formatFinanceDate(invoice.issued_at.slice(0, 10))}`
												: "Not issued yet"}
										</p>
									</div>
									<FinanceStatusBadge status={invoice.status} />
								</AppSurfaceCard>
							))}
						</div>
					)}
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

function ExportSection({
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

function ProjectBooksSection({
	bookId,
	teamId,
	canManageBook,
}: {
	bookId: string;
	teamId: string | null;
	canManageBook: boolean;
}) {
	const queryClient = useQueryClient();
	const [projectId, setProjectId] = useState("");

	const myBooksQuery = useQuery({
		queryKey: ["finance-books", "mine"],
		queryFn: financeBooksService.listMine,
	});
	const children = (myBooksQuery.data ?? []).filter(
		(book) => book.parent_book_id === bookId,
	);

	const teamProjectsQuery = useQuery({
		queryKey: ["teams", teamId, "projects"],
		queryFn: () => listTeamProjects(teamId as string),
		enabled: Boolean(teamId) && canManageBook,
	});
	const existing = new Set(children.map((child) => child.project_id));
	const candidates = (teamProjectsQuery.data ?? []).filter(
		(attachment) => !existing.has(attachment.project_id),
	);
	const projectTitles = new Map(
		(teamProjectsQuery.data ?? []).map((attachment) => [
			attachment.project_id,
			attachment.project?.title ?? null,
		]),
	);

	const addMutation = useMutation({
		mutationFn: () => financeBooksService.addProject(bookId, projectId),
		onSuccess: async () => {
			setProjectId("");
			await queryClient.invalidateQueries({ queryKey: ["finance-books"] });
		},
	});

	return (
		<>
			<AppSectionHeader
				title="Project books"
				subtitle="One child book per contracted project. Only projects with a signed client contract on this team can join."
				className="mt-8"
			/>
			{children.length === 0 ? (
				<AppEmptyState
					icon={FolderKanban}
					title="No project books yet"
					description="Add a project below once it has a signed client contract on this team."
					className="mt-3"
				/>
			) : (
				<div className="mt-3 space-y-2">
					{children.map((child) => (
						<Link
							key={child.id}
							to="/engagements/finance/book/$bookId"
							params={{ bookId: child.id }}
							className="block"
						>
							<AppSurfaceCard className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:border-slate-400">
								<p className="truncate text-sm font-semibold text-slate-900">
									{(child.project_id
										? projectTitles.get(child.project_id)
										: null) ?? "Project book"}
								</p>
								<span className="shrink-0 text-xs font-medium text-slate-500">
									{child.currency}
									{child.status === "archived" ? " · archived" : ""}
								</span>
							</AppSurfaceCard>
						</Link>
					))}
				</div>
			)}

			{canManageBook ? (
				<div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
					<select
						value={projectId}
						onChange={(event) => setProjectId(event.target.value)}
						className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 sm:max-w-sm"
					>
						<option value="">Add a project…</option>
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
						className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
					>
						{addMutation.isPending ? "Adding…" : "Add project"}
					</button>
				</div>
			) : null}
			{addMutation.isError ? (
				<p className="mt-2 text-sm font-medium text-red-600">
					{addMutation.error.message}
				</p>
			) : null}
		</>
	);
}
