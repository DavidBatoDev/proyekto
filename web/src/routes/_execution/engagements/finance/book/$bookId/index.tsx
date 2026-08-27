import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Archive,
	BookOpen,
	CheckCircle2,
	Clock,
	Download,
	FileSignature,
	FolderKanban,
	HandCoins,
	Hourglass,
	MailPlus,
	ReceiptText,
	Users,
} from "lucide-react";
import { useState } from "react";
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
import {
	FinanceLoading,
	FinanceStatusBadge,
	formatFinanceDate,
} from "@/components/finance/portfolio/FinancePrimitives";
import {
	type FinanceBookMember,
	type FinanceBookOverview,
	type FinanceExportFormat,
	type FinanceExportKind,
	financeBooksService,
	type GrantableFinanceRole,
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

const ROLE_OPTIONS: Array<{
	value: GrantableFinanceRole;
	label: string;
	description: string;
}> = [
	{
		value: "manager",
		label: "Manager",
		description:
			"The HR tier — sees costs, manages rates and payouts, inherits onto project books.",
	},
	{
		value: "accountant",
		label: "Accountant",
		description: "Views and exports time logs and payouts. Never edits.",
	},
	{
		value: "viewer_client",
		label: "Client viewer",
		description:
			"The client seat — their contracts and invoices only. Never sees internal costs.",
	},
	{
		value: "viewer",
		label: "Viewer",
		description: "Read-only view of time logs. No exports.",
	},
];

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

	return (
		<>
			<AppSectionHeader
				title={title}
				kicker={title === kindLabel ? undefined : kindLabel}
				subtitle={`Display currency ${book.currency} · your role: ${ROLE_LABELS[role] ?? role}${overview.inherited ? " (inherited from the team book)" : ""}.`}
				className="mt-4"
			/>

			{book.status === "archived" ? (
				<div className="mt-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5">
					<Archive className="h-4 w-4 shrink-0 text-amber-600" />
					<p className="text-sm text-amber-800">
						This book is archived — its client contract ended. History stays
						readable and exportable, but nothing new is recorded.
					</p>
				</div>
			) : null}

			<BookDashboard overview={overview} />

			{permissions.export ? (
				<ExportSection bookId={bookId} canViewTime={permissions.view_time} />
			) : null}

			<MembersSection bookId={bookId} canManage={permissions.manage_members} />

			{permissions.manage_members ? <InvitesSection bookId={bookId} /> : null}

			{book.kind === "team" ? (
				<ProjectBooksSection
					bookId={bookId}
					teamId={book.owner_team_id}
					canManageBook={permissions.manage_book}
				/>
			) : null}
		</>
	);
}

// ─── dashboard (role-sliced: keys absent from the payload never render) ───

function formatBookHours(seconds: number): string {
	return `${(seconds / 3600).toFixed(1)}h`;
}

function BookDashboard({ overview }: { overview: FinanceBookOverview }) {
	const { time, payouts, contracts, invoices } = overview;

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

// ─── members ──────────────────────────────────────────────────────────────

function MembersSection({
	bookId,
	canManage,
}: {
	bookId: string;
	canManage: boolean;
}) {
	const queryClient = useQueryClient();
	const membersQuery = useQuery({
		queryKey: ["finance-books", bookId, "members"],
		queryFn: () => financeBooksService.listMembers(bookId),
	});

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: ["finance-books", bookId, "members"],
		});

	const updateMutation = useMutation({
		mutationFn: ({
			memberId,
			finance_role,
		}: {
			memberId: string;
			finance_role: GrantableFinanceRole;
		}) => financeBooksService.updateMember(bookId, memberId, { finance_role }),
		onSuccess: invalidate,
	});

	const removeMutation = useMutation({
		mutationFn: (memberId: string) =>
			financeBooksService.removeMember(bookId, memberId),
		onSuccess: invalidate,
	});

	return (
		<>
			<AppSectionHeader
				title="Members"
				subtitle="Finance access only — a member here never gains access to the project work itself."
				className="mt-8"
			/>
			{membersQuery.isPending ? (
				<p className="mt-3 text-sm text-slate-500">Loading members…</p>
			) : (membersQuery.data?.length ?? 0) === 0 ? (
				<AppEmptyState
					icon={Users}
					title="No members yet"
					description="Invite an HR manager, accountant, or client viewer below."
					className="mt-3"
				/>
			) : (
				<div className="mt-3 space-y-2">
					{(membersQuery.data ?? []).map((member) => (
						<MemberRow
							key={member.id ?? `implicit-${member.user_id}`}
							member={member}
							canManage={canManage}
							onRoleChange={(finance_role) =>
								member.id
									? updateMutation.mutate({
											memberId: member.id,
											finance_role,
										})
									: undefined
							}
							onRemove={() =>
								member.id ? removeMutation.mutate(member.id) : undefined
							}
						/>
					))}
				</div>
			)}
			{updateMutation.isError ? (
				<p className="mt-2 text-sm font-medium text-red-600">
					{updateMutation.error.message}
				</p>
			) : null}
			{removeMutation.isError ? (
				<p className="mt-2 text-sm font-medium text-red-600">
					{removeMutation.error.message}
				</p>
			) : null}
		</>
	);
}

function MemberRow({
	member,
	canManage,
	onRoleChange,
	onRemove,
}: {
	member: FinanceBookMember;
	canManage: boolean;
	onRoleChange: (role: GrantableFinanceRole) => void;
	onRemove: () => void;
}) {
	const name =
		member.user?.display_name ||
		member.user?.email ||
		member.invited_email ||
		"Unknown member";
	// Implicit owners and inherited F2 grants have no row on this book to
	// edit — role changes for inherited managers happen on the team book.
	const editable = canManage && !member.inherited && member.id !== null;

	return (
		<AppSurfaceCard className="flex items-center justify-between gap-4 px-5 py-3.5">
			<div className="flex min-w-0 items-center gap-3">
				{member.user?.avatar_url ? (
					<img
						src={member.user.avatar_url}
						alt=""
						className="h-8 w-8 shrink-0 rounded-full object-cover"
					/>
				) : (
					<span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
						{name.slice(0, 1).toUpperCase()}
					</span>
				)}
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold text-slate-900">
						{name}
					</p>
					<p className="text-xs text-slate-500">
						{ROLE_LABELS[member.finance_role] ?? member.finance_role}
						{member.source === "team_owner"
							? " · team owner"
							: member.inherited
								? " · inherited from the team book"
								: ""}
					</p>
				</div>
			</div>
			{editable ? (
				<div className="flex shrink-0 items-center gap-2">
					<select
						value={member.finance_role}
						onChange={(event) =>
							onRoleChange(event.target.value as GrantableFinanceRole)
						}
						className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
					>
						{ROLE_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
					<button
						type="button"
						onClick={onRemove}
						className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-red-300 hover:text-red-600"
					>
						Remove
					</button>
				</div>
			) : null}
		</AppSurfaceCard>
	);
}

// ─── invites ──────────────────────────────────────────────────────────────

function InvitesSection({ bookId }: { bookId: string }) {
	const queryClient = useQueryClient();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<GrantableFinanceRole>("accountant");
	const [notice, setNotice] = useState<string | null>(null);

	const invitesQuery = useQuery({
		queryKey: ["finance-books", bookId, "invites"],
		queryFn: () => financeBooksService.listInvites(bookId),
	});

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: ["finance-books", bookId, "invites"],
		});

	const inviteMutation = useMutation({
		mutationFn: () =>
			financeBooksService.createInvite(bookId, { email, finance_role: role }),
		onSuccess: async (created) => {
			setEmail("");
			setNotice(
				created.email_delivery.sent
					? `Invitation emailed to ${created.email}.`
					: `Invitation created — the email could not be sent (${created.email_delivery.reason ?? "unknown reason"}). Share the link directly: ${created.accept_url}`,
			);
			await invalidate();
		},
	});

	const cancelMutation = useMutation({
		mutationFn: (inviteId: string) =>
			financeBooksService.cancelInvite(bookId, inviteId),
		onSuccess: invalidate,
	});

	const selectedRole = ROLE_OPTIONS.find((option) => option.value === role);
	const pending = (invitesQuery.data ?? []).filter(
		(invite) => invite.status === "pending",
	);

	return (
		<>
			<AppSectionHeader
				title="Invite someone"
				subtitle="Send finance-only access by email. Ownership is never invitable — it follows the book."
				className="mt-8"
			/>
			<AppSurfaceCard className="mt-3 p-5">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start">
					<input
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="name@company.com"
						className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 sm:max-w-xs"
					/>
					<select
						value={role}
						onChange={(event) =>
							setRole(event.target.value as GrantableFinanceRole)
						}
						className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 sm:w-44"
					>
						{ROLE_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
					<button
						type="button"
						disabled={!email.trim() || inviteMutation.isPending}
						onClick={() => {
							setNotice(null);
							inviteMutation.mutate();
						}}
						className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
					>
						<MailPlus className="h-4 w-4" />
						{inviteMutation.isPending ? "Sending…" : "Send invite"}
					</button>
				</div>
				{selectedRole ? (
					<p className="mt-2 text-xs text-slate-500">
						{selectedRole.description}
					</p>
				) : null}
				{inviteMutation.isError ? (
					<p className="mt-2 text-sm font-medium text-red-600">
						{inviteMutation.error.message}
					</p>
				) : null}
				{notice ? (
					<p className="mt-2 break-all text-sm font-medium text-emerald-700">
						{notice}
					</p>
				) : null}
			</AppSurfaceCard>

			{pending.length > 0 ? (
				<div className="mt-3 space-y-2">
					{pending.map((invite) => (
						<AppSurfaceCard
							key={invite.id}
							className="flex items-center justify-between gap-4 px-5 py-3"
						>
							<div className="min-w-0">
								<p className="truncate text-sm font-semibold text-slate-900">
									{invite.email}
								</p>
								<p className="text-xs text-slate-500">
									{ROLE_LABELS[invite.finance_role] ?? invite.finance_role} ·
									expires {new Date(invite.expires_at).toLocaleDateString()}
								</p>
							</div>
							<button
								type="button"
								disabled={cancelMutation.isPending}
								onClick={() => cancelMutation.mutate(invite.id)}
								className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-60"
							>
								Cancel
							</button>
						</AppSurfaceCard>
					))}
				</div>
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
