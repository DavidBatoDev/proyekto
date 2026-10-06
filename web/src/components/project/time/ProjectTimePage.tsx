import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Clock, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useMemo } from "react";
import { useTeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";
import { ClientHoursView } from "@/components/time/report/ClientHoursView";
import { ReportFilters } from "@/components/time/report/ReportFilters";
import {
	ALL_TIME_START,
	type ReportPlanWorkspace,
	reportRangeFrom,
	type TimeReportSearch,
} from "@/components/time/report/reportModel";
import { TimeReport } from "@/components/time/report/TimeReport";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import {
	useProjectDetailQuery,
	useProjectMyPermissionsQuery,
} from "@/hooks/useProjectQueries";
import { useMyWorkspacesQuery } from "@/hooks/useWorkspaceQueries";
import { httpStatusOf } from "@/lib/apiErrors";
import { isNativeApp } from "@/lib/platform";
import { projectTimeAccess } from "@/lib/projectPermissions";
import { deviceTimeZone } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import { toWorkspacePath } from "@/lib/workspacePaths";
import { timeQueries } from "@/queries/time";
import { listMyTeams, listProjectTeams } from "@/services/teams.service";
import { useUser } from "@/stores/authStore";
import {
	clientHoursAgreements,
	PROJECT_TIME_COPY,
	type ProjectTimeSearch,
	type ProjectTimeView,
	probeEndDate,
	resolveProjectTimeView,
} from "./projectTimeModel";
import { useProjectClientAgreements } from "./useProjectClientAgreements";

/**
 * Project › Time (ux.md › Reports › Project › Time page, L22, L55).
 *
 * ```
 * Time · Acme Website                                   Your time on this project →
 * [Everyone] [Client hours]     Sep 1 – 30 ▾   Person ▾   For ▾   Status ▾   [Export]
 * PRODIGITALITY SERVICES… · team        Approved 120:30 · Not yet approved 14:00 · PHP 54,225.00
 * DELIVERY TEAM · agreement with Acme Corp            Approved 38:00   (hours only)
 * ```
 *
 * - **Everyone** (`time.view_team_logs`): every governed context on the
 *   project in sections (the report kit's `layout="sections"`). Personal
 *   time never appears; the server masks assignment people for non-parties.
 * - **Client hours** (a client-hours level other than `none`): approved hours
 *   per client agreement at that agreement's level, never a name or a cost.
 * - "Mine" is gone: "Your time on this project →" opens `/time?project=`, and
 *   someone who only logs here is sent there (the route's redirect map).
 * - Every refusal is a reason card; nothing renders as an empty page.
 * - Entry rows don't open here (see `EveryoneView`).
 */
export interface ProjectTimePageProps {
	projectId: string;
	search: ProjectTimeSearch;
	/** Merge into the URL; `undefined` removes a param. */
	onSearchChange: (patch: Partial<ProjectTimeSearch>) => void;
	/** Someone who only logs here (or reads their own entries): off to Time. */
	onRedirectMine: () => void;
	now?: Date;
}

const VIEW_LABEL: Record<ProjectTimeView, string> = {
	everyone: PROJECT_TIME_COPY.everyone,
	client: PROJECT_TIME_COPY.client,
};

function Skeleton({ rows = 2 }: { rows?: number }) {
	return (
		<div className="space-y-3" aria-busy="true">
			{Array.from({ length: rows }, (_, i) => (
				<div
					key={i}
					className="h-16 animate-pulse rounded-xl border border-border bg-muted/50"
				/>
			))}
		</div>
	);
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
	return (
		<button
			type="button"
			onClick={onRetry}
			className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
		>
			<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
			{PROJECT_TIME_COPY.retry}
		</button>
	);
}

/** "Your time on this project lives in Time. [Open →]" */
function OwnTimeCard({ projectId }: { projectId: string }) {
	return (
		<TimeReasonCard
			tone="neutral"
			icon={Clock}
			title={PROJECT_TIME_COPY.linkCardTitle}
			action={
				<Link
					to="/time"
					search={{ project: projectId }}
					className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
				>
					{PROJECT_TIME_COPY.open}
					<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
				</Link>
			}
		/>
	);
}

function ViewSwitch({
	views,
	view,
	onChange,
}: {
	views: readonly ProjectTimeView[];
	view: ProjectTimeView;
	onChange: (view: ProjectTimeView) => void;
}) {
	if (views.length < 2) return null;
	return (
		<div
			role="group"
			aria-label={PROJECT_TIME_COPY.viewGroup}
			className="inline-flex w-full rounded-lg border border-border bg-card p-1 sm:w-auto"
		>
			{views.map((item) => {
				const active = item === view;
				return (
					<button
						key={item}
						type="button"
						aria-pressed={active}
						onClick={() => onChange(item)}
						className={cn(
							"flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none",
							active
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:bg-muted hover:text-foreground",
						)}
					>
						{VIEW_LABEL[item]}
					</button>
				);
			})}
		</div>
	);
}

export function ProjectTimePage({
	projectId,
	search,
	onSearchChange,
	onRedirectMine,
	now,
}: ProjectTimePageProps) {
	const permissionsQuery = useProjectMyPermissionsQuery(projectId);
	const projectQuery = useProjectDetailQuery(projectId);
	const access = projectTimeAccess(permissionsQuery.data);
	const outcome = permissionsQuery.data
		? resolveProjectTimeView(access, search.view)
		: null;
	const outcomeKind = outcome?.kind ?? null;

	// The redirect map: someone who only logs here belongs on their own page.
	useEffect(() => {
		if (outcomeKind === "redirect_mine") onRedirectMine();
	}, [outcomeKind, onRedirectMine]);

	const title = projectQuery.data?.title;

	let body: ReactNode;
	if (permissionsQuery.isPending) {
		body = <Skeleton />;
	} else if (permissionsQuery.isError || !outcome) {
		// A refusal (403 not on the project, 404) reads as no access; anything
		// else (5xx, network) can be retried. `getMyPermissions` throws an
		// ApiError, so the status survives.
		const status = httpStatusOf(permissionsQuery.error);
		body =
			status === 403 || status === 404 ? (
				<TimeReasonCard tone="danger" title={PROJECT_TIME_COPY.deniedTitle}>
					{PROJECT_TIME_COPY.deniedDetail}
				</TimeReasonCard>
			) : (
				<TimeReasonCard
					tone="danger"
					role="alert"
					title={PROJECT_TIME_COPY.accessLoadError}
					action={
						<RetryButton onRetry={() => void permissionsQuery.refetch()} />
					}
				/>
			);
	} else if (outcome.kind === "denied") {
		body = (
			<TimeReasonCard tone="danger" title={PROJECT_TIME_COPY.deniedTitle}>
				{PROJECT_TIME_COPY.deniedDetail}
			</TimeReasonCard>
		);
	} else if (outcome.kind === "view") {
		const toolbar = (
			<ViewSwitch
				views={outcome.views}
				view={outcome.view}
				onChange={(view) => onSearchChange({ view })}
			/>
		);
		body =
			outcome.view === "everyone" ? (
				<EveryoneView
					projectId={projectId}
					workspaceId={projectQuery.data?.workspace_id ?? null}
					search={search}
					onSearchChange={onSearchChange}
					toolbar={toolbar}
					now={now}
				/>
			) : (
				<ClientView
					projectId={projectId}
					search={search}
					onSearchChange={onSearchChange}
					toolbar={toolbar}
					now={now}
				/>
			);
	} else {
		// link_card, and redirect_mine while the navigation lands.
		body = <OwnTimeCard projectId={projectId} />;
	}

	return (
		<div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-6 sm:px-6 md:px-8 md:py-8">
			<header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
				<h1 className="min-w-0 text-2xl font-semibold tracking-tight text-foreground">
					{PROJECT_TIME_COPY.title}
					{title ? (
						<span className="font-normal text-muted-foreground">
							{" · "}
							{title}
						</span>
					) : null}
				</h1>
				{access.canLog ? (
					<Link
						to="/time"
						search={{ project: projectId }}
						className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline"
					>
						{PROJECT_TIME_COPY.yourTime}
						<ArrowRight className="h-4 w-4" aria-hidden="true" />
					</Link>
				) : null}
			</header>
			{body}
		</div>
	);
}

// ── Everyone ────────────────────────────────────────────────────────────────

function EveryoneView({
	projectId,
	workspaceId,
	search,
	onSearchChange,
	toolbar,
	now,
}: {
	projectId: string;
	workspaceId: string | null;
	search: ProjectTimeSearch;
	onSearchChange: (patch: Partial<ProjectTimeSearch>) => void;
	toolbar: ReactNode;
	now?: Date;
}) {
	const native = isNativeApp();
	const workspacesQuery = useMyWorkspacesQuery();
	const planWorkspace = useMemo<ReportPlanWorkspace | null>(() => {
		if (!workspaceId) return null;
		const ws = workspacesQuery.data?.find((item) => item.id === workspaceId);
		return ws
			? { id: ws.id, name: ws.name, slug: ws.slug, my_role: ws.my_role }
			: { id: workspaceId };
	}, [workspaceId, workspacesQuery.data]);

	// Has anyone ever logged here? One row is enough to know; "No time on this
	// project yet" is about the project, not the range on screen.
	const probe = useQuery(
		timeQueries.reportEntries({
			scope: { kind: "project", id: projectId },
			from: ALL_TIME_START,
			to: probeEndDate(now),
			page: 1,
			limit: 1,
		}),
	);

	const reportSearch: TimeReportSearch = search;
	const onReportSearchChange = (patch: Partial<TimeReportSearch>) => {
		const { project: _project, group: _group, ...rest } = patch;
		onSearchChange(rest);
	};

	if (probe.isPending) {
		return (
			<div className="space-y-4">
				{toolbar}
				<Skeleton />
			</div>
		);
	}

	if (probe.data && probe.data.total === 0) {
		return (
			<div className="space-y-4">
				{toolbar}
				<TimeReasonCard
					tone="neutral"
					icon={Clock}
					title={PROJECT_TIME_COPY.emptyTitle}
					action={
						<Link
							to="/project/$projectId/settings/time"
							params={{ projectId }}
							hash="who-can-log"
							className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
						>
							{PROJECT_TIME_COPY.whoCanLogLink}
							<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
						</Link>
					}
				>
					{PROJECT_TIME_COPY.emptyDetail}
				</TimeReasonCard>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{native ? null : <TeamMoneyLinks projectId={projectId} />}
			{/*
			 * Rows are read-only here (no onOpenEntry). The Everyone view is
			 * authorised by time.view_team_logs, but the entry read is not: it
			 * admits only the member, the sheet's viewers (can_view_timesheet)
			 * and team managers (D49). A project admin who is neither would
			 * click a row they were just shown and land on the "doesn't exist
			 * or you can't open it" card, and masked assignment rows never open
			 * for a non-party. People open their own entries from Time, team
			 * managers from Team › Time, deciders from the timesheet review.
			 */}
			<TimeReport
				scope={{ kind: "project", id: projectId }}
				search={reportSearch}
				onSearchChange={onReportSearchChange}
				layout="sections"
				planWorkspace={planWorkspace}
				toolbar={toolbar}
				now={now}
			/>
		</div>
	);
}

/**
 * Where a team manager pays and prices the team's time on this project. The
 * old page linked one hard-coded `/teams/<primary>/time/payouts`; this is one
 * line per attached team the caller manages, through `toWorkspacePath`.
 * Money pages are web only (L54), so the app never renders this.
 */
function TeamMoneyLinks({ projectId }: { projectId: string }) {
	const user = useUser();
	const attachedQuery = useQuery({
		queryKey: ["project", projectId, "teams"],
		queryFn: () => listProjectTeams(projectId),
	});
	const mineQuery = useQuery({
		queryKey: ["teams", "mine", user?.id ?? null],
		queryFn: listMyTeams,
		enabled: Boolean(user?.id),
	});
	const teams = useMemo(() => {
		// Only teams the caller is on: the team read is gated on membership.
		const mine = new Set((mineQuery.data ?? []).map((team) => team.id));
		return (attachedQuery.data ?? [])
			.filter((attachment) => mine.has(attachment.team_id))
			.map((attachment) => ({
				id: attachment.team_id,
				name: attachment.team?.name ?? null,
			}));
	}, [attachedQuery.data, mineQuery.data]);

	if (teams.length === 0) return null;
	return (
		<nav
			aria-label={PROJECT_TIME_COPY.teamMoney}
			className="flex flex-wrap items-center gap-x-5 gap-y-1"
		>
			{teams.map((team) => (
				<TeamMoneyLink key={team.id} teamId={team.id} name={team.name} />
			))}
		</nav>
	);
}

function TeamMoneyLink({
	teamId,
	name,
}: {
	teamId: string;
	name: string | null;
}) {
	const money = useTeamMoneyAccess(teamId);
	if (!money.isApprover || (!money.canPay && !money.hasRates)) return null;
	const slug = money.planWorkspace?.slug ?? null;
	const teamName = name ?? money.team?.name ?? "Team";
	const linkClass =
		"font-semibold text-primary hover:underline focus-visible:underline";
	return (
		<p className="text-xs text-muted-foreground">
			<span className="font-medium text-foreground">{teamName}</span>
			{money.canPay ? (
				<>
					{" · "}
					<Link
						to={toWorkspacePath(`/teams/${teamId}/time/payouts`, slug)}
						className={linkClass}
						aria-label={`${PROJECT_TIME_COPY.payouts}: ${teamName}`}
					>
						{PROJECT_TIME_COPY.payouts}
					</Link>
				</>
			) : null}
			{money.hasRates ? (
				<>
					{" · "}
					<Link
						to={toWorkspacePath(`/teams/${teamId}/time/manage-rates`, slug)}
						className={linkClass}
						aria-label={`${PROJECT_TIME_COPY.rates}: ${teamName}`}
					>
						{PROJECT_TIME_COPY.rates}
					</Link>
				</>
			) : null}
		</p>
	);
}

// ── Client hours ────────────────────────────────────────────────────────────

function ClientView({
	projectId,
	search,
	onSearchChange,
	toolbar,
	now,
}: {
	projectId: string;
	search: ProjectTimeSearch;
	onSearchChange: (patch: Partial<ProjectTimeSearch>) => void;
	toolbar: ReactNode;
	now?: Date;
}) {
	const agreementsQuery = useProjectClientAgreements(projectId);
	const timezone = deviceTimeZone();
	const range = reportRangeFrom(search, { timezone, now });
	const agreements = useMemo(
		() => clientHoursAgreements(agreementsQuery.data, projectId),
		[agreementsQuery.data, projectId],
	);

	let body: ReactNode;
	if (agreementsQuery.isPending) {
		body = <Skeleton />;
	} else if (agreementsQuery.isError) {
		body = (
			<TimeReasonCard
				variant="inline"
				tone="danger"
				role="alert"
				title={PROJECT_TIME_COPY.clientLoadError}
				action={<RetryButton onRetry={() => void agreementsQuery.refetch()} />}
			/>
		);
	} else {
		body = <ClientHoursView agreements={agreements} range={range} />;
	}

	return (
		<div className="space-y-4">
			<ReportFilters
				range={range}
				onRangeChange={(next) =>
					onSearchChange({ from: next.from, to: next.to })
				}
				timezone={timezone}
				leading={toolbar}
				now={now}
			/>
			<p className="px-1 text-xs text-muted-foreground">
				{PROJECT_TIME_COPY.clientHint}
			</p>
			{body}
		</div>
	);
}
