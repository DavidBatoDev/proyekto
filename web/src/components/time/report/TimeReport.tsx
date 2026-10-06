import { RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
	featureLimitInfo,
	PlanLimitNotice,
} from "@/components/billing/PlanLimitNotice";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { useEntitlements } from "@/hooks/useEntitlements";
import { isNativeApp } from "@/lib/platform";
import { timeErrorCopy, timePlanCopy } from "@/lib/timeErrors";
import {
	canShowAmounts,
	type DateFormatOptions,
	deviceTimeZone,
} from "@/lib/timeFormat";
import { safeTimezone } from "@/lib/timePeriods";
import {
	TIME_REPORT_GROUPS,
	type TimeReportForKind,
	type TimeReportGroup,
} from "@/lib/timeSearch";
import { cn } from "@/lib/utils";
import type { PayPeriodConfig } from "@/services/teams.service";
import { isTimeApiError } from "@/services/time.service";
import type {
	ReportGroupBy,
	ReportScopeKind,
	ReportScopeRef,
	TimeEntryView,
} from "@/services/time.types";
import { ExportButton } from "./ExportButton";
import { ReportEntriesTable } from "./ReportEntriesTable";
import { ReportFilters } from "./ReportFilters";
import { ReportGroupTable } from "./ReportGroupTable";
import { ReportSections } from "./ReportSections";
import { ReportTotals } from "./ReportTotals";
import {
	approvalSplitFor,
	approvedSummaryQuery,
	entriesPageQuery,
	exportQuery,
	isPersonRow,
	noticeWorkspace,
	peopleFromSummary,
	peopleSummaryQuery,
	REPORT_COPY,
	REPORT_ENTRIES_CAP,
	REPORT_ENTRIES_PAGE_SIZE,
	type ReportFigures,
	type ReportPersonOption,
	type ReportPlanWorkspace,
	type ReportRange,
	reportAmountsAllowed,
	reportFigures,
	reportFilterQuery,
	reportGroupBy,
	reportRangeFrom,
	sectionsFromEntries,
	sectionTotals,
	summaryQuery,
	type TimeReportSearch,
	timezoneCaption,
} from "./reportModel";
import { UnderAgreementsSection } from "./UnderAgreementsSection";
import {
	useAllReportEntries,
	useReportEntriesPage,
	useReportSummary,
} from "./useTimeReport";

/**
 * One time report for every mount (ux.md › Reports): Team › Time and Finance
 * › team › Time (team scope), the workspace report (workspace scope), Project
 * › Time · Everyone (project scope, `layout="sections"`) and Engagement ›
 * Time (engagement scope). The host owns the URL: it passes the validated
 * search (`validateTeamTimeReportSearch`) and merges `onSearchChange`
 * patches back, with `undefined` meaning "remove".
 *
 * - Filters: range (in the scope's policy timezone), person, For, status;
 *   group by person, project, task, day or week (`grouped` layout).
 * - Totals: Approved and Not yet approved, never summed; Billable when known;
 *   Cost only where the server counted visible cost, never agreement amounts
 *   on native.
 * - The workspace scope needs `time_reports_export` even to read (backend
 *   `workspaceScope`), so it checks the plan first and shows the notice.
 * - Every refusal renders a reason card; a 404 reads "This doesn't exist or
 *   you can't open it."
 *
 * The client's "Client hours" view is `ClientHoursView`, not this.
 */
export interface TimeReportProps {
	scope: ReportScopeRef;
	search: TimeReportSearch;
	onSearchChange: (patch: Partial<TimeReportSearch>) => void;
	/** `grouped` (default): totals, a group table, entries. `sections`: one section per context (project Everyone). */
	layout?: "grouped" | "sections";
	/** The grouping when the URL names none. */
	defaultGroup?: TimeReportGroup;
	/** The scope's policy timezone, when the host knows it, for the default range and presets. */
	timezone?: string | null;
	/** The scope's ISO week start for "This week". */
	weekStart?: number | null;
	/** People for the Person filter; omitted: whoever logged in the range. */
	people?: readonly ReportPersonOption[];
	showPersonFilter?: boolean;
	/** For kinds to offer; defaults by scope (none on team and engagement scopes). */
	forKinds?: readonly TimeReportForKind[];
	showStatusFilter?: boolean;
	/** Team scope by default: the hours-only "Under agreements" line. */
	showUnderAgreements?: boolean;
	showExport?: boolean;
	/** The workspace whose plan covers the report (defaults to the workspace scope itself). */
	planWorkspace?: ReportPlanWorkspace | null;
	/** Offers the team's pay cut-offs in the range picker (web only). */
	cutoffs?: { config: PayPeriodConfig | null } | null;
	/** Opens an entry (the host's detail modal, or `/time?entry=`). */
	onOpenEntry?: (entry: TimeEntryView) => void;
	/** Before the range in the filter row (a view switch). */
	toolbar?: ReactNode;
	title?: ReactNode;
	className?: string;
	now?: Date;
}

const DEFAULT_FOR_KINDS: Record<ReportScopeKind, readonly TimeReportForKind[]> =
	{
		team: [],
		project: ["team", "workspace", "assignment"],
		workspace: ["team", "workspace", "assignment"],
		engagement: [],
	};

function RetryButton({ onRetry }: { onRetry: () => void }) {
	return (
		<button
			type="button"
			onClick={onRetry}
			className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
		>
			<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
			{REPORT_COPY.retry}
		</button>
	);
}

function ErrorCard({
	error,
	onRetry,
	planWorkspace,
}: {
	error: unknown;
	onRetry: () => void;
	planWorkspace: ReportPlanWorkspace | null | undefined;
}) {
	const planInfo = isTimeApiError(error) ? error.planLimit : null;
	if (planInfo) {
		return (
			<PlanLimitNotice
				info={planInfo}
				workspace={noticeWorkspace(planWorkspace)}
				message={timePlanCopy("time_reports_export", {
					workspaceName: planWorkspace?.name,
				})}
			/>
		);
	}
	const copy = timeErrorCopy(error, { subject: "scope", operation: "read" });
	return (
		<TimeReasonCard
			variant="inline"
			role="alert"
			tone={copy.notFound ? "not-found" : "danger"}
			title={copy.message}
			action={copy.notFound ? null : <RetryButton onRetry={onRetry} />}
		/>
	);
}

export function TimeReport({
	scope,
	search,
	onSearchChange,
	layout = "grouped",
	defaultGroup = "person",
	timezone,
	weekStart,
	people,
	showPersonFilter = true,
	forKinds,
	showStatusFilter = true,
	showUnderAgreements,
	showExport = true,
	planWorkspace,
	cutoffs,
	onOpenEntry,
	toolbar,
	title,
	className,
	now,
}: TimeReportProps) {
	const native = isNativeApp();
	const userTimezone = deviceTimeZone();
	const hostTimezone = timezone ? safeTimezone(timezone) : null;
	const sections = layout === "sections";

	const range: ReportRange = reportRangeFrom(search, {
		timezone: hostTimezone ?? userTimezone,
		weekStart,
		now,
	});
	const filters = reportFilterQuery(scope, search, range);
	const filterKey = JSON.stringify(filters);
	const group = search.group ?? defaultGroup;
	const groupBy: ReportGroupBy = sections ? "context" : reportGroupBy(group);
	const split = approvalSplitFor(search.status);

	// Workspace scope: the plan gates the read itself, so check it first.
	const plan: ReportPlanWorkspace | null =
		planWorkspace ?? (scope.kind === "workspace" ? { id: scope.id } : null);
	const workspaceGateId = scope.kind === "workspace" ? scope.id : null;
	const gateEntitlements = useEntitlements(workspaceGateId);
	const scopePlanInfo = workspaceGateId
		? featureLimitInfo(gateEntitlements, "time_reports_export")
		: null;
	const enabled =
		(!workspaceGateId || gateEntitlements.status !== "loading") &&
		!scopePlanInfo;

	const summary = useReportSummary(summaryQuery(filters, groupBy), enabled);
	const approved = useReportSummary(
		approvedSummaryQuery(filters, groupBy),
		enabled && !sections && split === "derive",
	);
	const peopleSummary = useReportSummary(
		peopleSummaryQuery(filters),
		enabled && showPersonFilter && !people,
	);

	const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
	const page = pageState.key === filterKey ? pageState.page : 1;
	const setPage = (next: number) =>
		setPageState({ key: filterKey, page: Math.max(1, next) });
	const entriesPage = useReportEntriesPage(
		entriesPageQuery(filters, page),
		enabled && !sections,
	);
	const allEntries = useAllReportEntries(filters, enabled && sections);

	// A page past the end (the range shrank under it) goes to the last page.
	const pageData = entriesPage.data;
	useEffect(() => {
		if (!pageData || entriesPage.isPlaceholderData) return;
		if (pageData.items.length === 0 && pageData.total > 0 && page > 1) {
			setPageState({
				key: filterKey,
				page: Math.max(1, Math.ceil(pageData.total / REPORT_ENTRIES_PAGE_SIZE)),
			});
		}
	}, [pageData, entriesPage.isPlaceholderData, page, filterKey]);

	const sectionList = useMemo(
		() => (allEntries.data ? sectionsFromEntries(allEntries.data) : null),
		[allEntries.data],
	);
	const capped = (allEntries.data?.length ?? 0) >= REPORT_ENTRIES_CAP;

	const grouped = useMemo(
		() =>
			!sections && summary.data
				? reportFigures(
						summary.data,
						split === "derive" ? approved.data : null,
						split,
					)
				: null,
		[sections, summary.data, approved.data, split],
	);

	const figures: ReportFigures | null = useMemo(() => {
		if (!sections) return grouped?.totals ?? null;
		if (!sectionList) return null;
		const totals = sectionTotals(sectionList);
		// Native never shows an agreement amount, so its total leaves them out.
		const shown = sectionList.filter(
			(s) =>
				s.costVisible &&
				canShowAmounts({ cost: "visible", kind: s.kind, native }),
		);
		return { ...totals, amounts: sectionTotals(shown).amounts };
	}, [sections, grouped, sectionList, native]);

	const peopleOptions = useMemo(
		() => people ?? peopleFromSummary(peopleSummary.data),
		[people, peopleSummary.data],
	);

	// A disabled query also reads `isPending`, so only a split that is read can be pending.
	const notApprovedPending =
		!sections && split === "derive" && approved.isPending;
	// A failed Not yet approved read says so, with Try again (never a bare "—").
	const notApprovedError =
		!sections && split === "derive" && approved.isError
			? {
					message: timeErrorCopy(approved.error, {
						subject: "scope",
						operation: "read",
					}).message,
					onRetry: () => void approved.refetch(),
					retrying: approved.isFetching,
				}
			: null;
	const reportTimezone = summary.data?.timezone ?? hostTimezone ?? userTimezone;
	const dateOptions: DateFormatOptions = { userTimezone, now };
	const showCaption = reportTimezone !== userTimezone;
	const underAgreements =
		(showUnderAgreements ?? scope.kind === "team")
			? summary.data?.under_agreements_seconds
			: undefined;

	const sectionEntries = allEntries.data ?? [];
	const tableEntries = sections
		? sectionEntries.slice(
				(page - 1) * REPORT_ENTRIES_PAGE_SIZE,
				page * REPORT_ENTRIES_PAGE_SIZE,
			)
		: (entriesPage.data?.items ?? []);
	const tableTotal = sections
		? sectionEntries.length
		: (entriesPage.data?.total ?? 0);
	const tableLoading = sections
		? allEntries.isPending
		: entriesPage.isPending || entriesPage.isPlaceholderData;
	const tableError = sections ? allEntries.error : entriesPage.error;

	const filtersRow = (
		<ReportFilters
			range={range}
			onRangeChange={(next) => onSearchChange({ from: next.from, to: next.to })}
			timezone={reportTimezone}
			weekStart={weekStart}
			cutoffs={cutoffs}
			people={showPersonFilter ? peopleOptions : null}
			person={search.person}
			onPersonChange={(person) => onSearchChange({ person })}
			forKinds={forKinds ?? DEFAULT_FOR_KINDS[scope.kind]}
			forKind={search.for}
			onForChange={(kind) => onSearchChange({ for: kind })}
			showStatus={showStatusFilter}
			status={search.status}
			onStatusChange={(status) => onSearchChange({ status })}
			groups={sections ? [] : TIME_REPORT_GROUPS}
			group={group}
			onGroupChange={(next) => onSearchChange({ group: next })}
			leading={toolbar}
			trailing={
				showExport && !scopePlanInfo ? (
					<ExportButton
						query={exportQuery(filters, sections ? undefined : groupBy)}
						planWorkspace={plan}
					/>
				) : null
			}
			now={now}
		/>
	);

	let body: ReactNode;
	if (scopePlanInfo) {
		body = (
			<PlanLimitNotice
				info={scopePlanInfo}
				workspace={noticeWorkspace(plan)}
				message={timePlanCopy("time_reports_export", {
					workspaceName: plan?.name,
				})}
				isComplimentary={gateEntitlements.isComplimentary}
			/>
		);
	} else if (summary.isError) {
		body = (
			<ErrorCard
				error={summary.error}
				planWorkspace={plan}
				onRetry={() => void summary.refetch()}
			/>
		);
	} else {
		body = (
			<>
				<ReportTotals
					figures={figures}
					loading={sections ? allEntries.isPending : summary.isPending}
					notApprovedPending={notApprovedPending}
					notApprovedError={notApprovedError}
					showAmounts={
						sections || reportAmountsAllowed({ scopeKind: scope.kind, native })
					}
					sheetCounts={summary.data?.sheet_status_counts}
				/>
				{sections ? (
					<ReportSections
						sections={sectionList ?? []}
						loading={allEntries.isPending}
						capped={capped}
					/>
				) : (
					<ReportGroupTable
						groupBy={groupBy}
						rows={grouped?.rows ?? []}
						loading={summary.isPending}
						notApprovedPending={notApprovedPending}
						amountsFor={(row) =>
							reportAmountsAllowed({
								scopeKind: scope.kind,
								groupBy,
								rowKey: row.key,
								native,
							})
						}
						dateOptions={dateOptions}
						onSelectRow={
							showPersonFilter
								? (row) => onSearchChange({ person: row.key })
								: undefined
						}
						canSelect={(row) =>
							isPersonRow(groupBy, row.key) && row.key !== search.person
						}
					/>
				)}
				<UnderAgreementsSection seconds={underAgreements} />
				<section aria-label={REPORT_COPY.entries} className="space-y-2">
					<h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{REPORT_COPY.entries}
					</h3>
					{tableError ? (
						<ErrorCard
							error={tableError}
							planWorkspace={plan}
							onRetry={() =>
								void (sections ? allEntries.refetch() : entriesPage.refetch())
							}
						/>
					) : (
						<ReportEntriesTable
							entries={tableEntries}
							total={tableTotal}
							page={page}
							onPageChange={setPage}
							loading={tableLoading}
							timezone={reportTimezone}
							showFor={scope.kind !== "team"}
							onOpenEntry={onOpenEntry}
							dateOptions={dateOptions}
						/>
					)}
				</section>
			</>
		);
	}

	return (
		<div className={cn("space-y-4", className)}>
			{title ? (
				<h2 className="text-base font-semibold text-foreground">{title}</h2>
			) : null}
			{filtersRow}
			{showCaption ? (
				<p className="-mt-2 px-1 text-xs text-muted-foreground">
					{timezoneCaption(reportTimezone)}
				</p>
			) : null}
			{body}
		</div>
	);
}
