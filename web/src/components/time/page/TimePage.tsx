// web/src/components/time/page/TimePage.tsx
//
// The bare `/time` page (ux.md › The Time Page, CHANGE-10): where everyone
// logs, submits and approves, whatever the time is for.
//
// Normal mode (desktop):
//
//   Time ……………………………………………………………………………… [⏳ Waiting for you · 3]
//   ● 01:12:44  Fix login bug · Acme Website   For: [Prodigitality… ▾] [❚❚][■]   timer bar (while running)
//   [▶ Start timer]  [+ Add time]                For: [All ▾]   [List | Month]
//   [ Task or preset ▾ ] [ 1:30 ] [ Yesterday ▾ ] [For ▾] [Add]  More options →  quick add
//   ‹  Sep 29 – Oct 5, 2026  ›   This week          Your time (Asia/Manila) ⓘ ⚙
//   Mon 6:30 · Tue 8:10 · … · Week 34:45                                       day strip
//   TIMESHEETS IN THIS WEEK                                                     cards
//   (entries table: Needs review, day groups, For column)
//   WAITING FOR YOU (3)                                   [Approve selected]
//
// Two tabs under the title: My time (the toolbar, quick add, week strip and
// entries) and Approvals (N) (this workspace's Waiting for you, then Decided),
// shown only to someone who can approve here. `?tab=approvals` opens it;
// without a tab, someone with no time of their own here who can approve
// lands on Approvals, as does `#waiting` with something waiting.
// `overview.approver_mode` switches nothing. Owners and admins get a "Time
// policy" button in the header; only a policy to confirm or a plan notice
// shows a slim banner under the tabs.
//
// Time is per workspace (workspaceGroups.ts): the page follows the sidebar's
// workspace switcher. Its waiting rows, cards, For choices, entries and
// policy cards are the open workspace's; personal and agreement time shows in
// the person's default workspace only, with agreement sheets under "Personal
// & agreements". The running timer stays global. A workspace where the
// person has no time gets a calm "not set up" state instead of the page.
//
// One-time cards sit above the timer bar: the policy confirm card (owners and
// admins), the legacy grouping banner and the owner-only plan notice.
//
// Below 640 px: the running timer bar sticks under the app header; the day
// strip scrolls sideways; the table folds to Task + Dur; a FAB opens Start
// timer / Add time; Waiting for you keeps bulk approve in its header.
//
// The page is router-agnostic: the route passes the parsed search, a setter
// and the hash. Every write in the kits invalidates through `invalidateTime`,
// so nothing here refetches by hand, except when the polled running timer
// changes under the page (another device or tab): then the lists refresh.

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Clock, Play, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { isNativeApp } from "@/lib/platform";
import { isVisibleInApp } from "@/lib/platformSurfaces";
import { nativeSafe, timeErrorMessage } from "@/lib/timeErrors";
import { formatLocalDay, formatPeriodRange } from "@/lib/timeFormat";
import { shiftWeek } from "@/lib/timePeriods";
import type { TimeForParam, TimePageSearch } from "@/lib/timeSearch";
import { cn } from "@/lib/utils";
import { invalidateTime, TIME_PREFIX, timeQueries } from "@/queries/time";
import type {
	TimeEntryView,
	TimesheetEventRow,
	TimesheetSummary,
} from "@/services/time.types";
import { DecidedList } from "../approvals/DecidedList";
import { TimeMonthView } from "../calendar/TimeMonthView";
import { TimeViewToggle, useTimeViewMode } from "../calendar/TimeViewToggle";
import { ChangeForDialog } from "../edit/ChangeForDialog";
import { DeleteEntryModal } from "../edit/DeleteEntryModal";
import { EditEntryModal } from "../edit/EditEntryModal";
import { TimeEntryDetailModal } from "../entries/TimeEntryDetailModal";
import { LoggingScopeProvider } from "../forms/loggingScope";
import {
	type ManualEntryDraft,
	ManualEntryModal,
} from "../forms/ManualEntryModal";
import { TaskPickerModal } from "../forms/TaskPickerModal";
import { useLoggableProjects } from "../forms/useLoggableProjects";
import { TimeReasonCard } from "../shared/TimeReasonCard";
import { SubmitSheetDialog } from "../sheets/SubmitSheetDialog";
import { timesheetCardLabel } from "../sheets/TimesheetCard";
import { useTimesheetActions } from "../sheets/useTimesheetActions";
import { TimerBar } from "../timer/TimerBar";
import { useActiveTimer, useRunningEntry } from "../timer/useActiveTimer";
import { DayStrip } from "./DayStrip";
import {
	ENTRIES_SECTION_COPY,
	EntriesSection,
	useChangeEntryTask,
} from "./EntriesSection";
import { ForFilter, usePersonalWhy } from "./ForFilter";
import { LegacyGroupingBanner } from "./LegacyGroupingBanner";
import {
	LimitBanner,
	limitReadingsFromPolicy,
	logsInWorkspace,
	planDowngradeApplies,
	TimePlanBanner,
} from "./LimitBanner";
import { PolicyConfirmCard, unconfirmedAdmins } from "./PolicyConfirmCard";
import {
	pickTimeEmptyState,
	TIME_EMPTY_COPY,
	TimeEmptyState,
} from "./TimeEmptyStates";
import { TimeMobileFab } from "./TimeMobileFab";
import { TimePageHeader } from "./TimePageHeader";
import { TimePolicyButton } from "./TimePolicyButton";
import { TimePrefsMenu } from "./TimePrefsMenu";
import { TimesheetCardsSection } from "./TimesheetCardsSection";
import { resolveTimeTab, type TimeTab, TimeTabs } from "./TimeTabs";
import {
	entriesOnDay,
	onlyPersonal,
	useTimePageData,
	weekParam,
} from "./useTimePageData";
import { useTimeWorkspaceScope } from "./useTimeWorkspaceScope";
import { WAITING_SECTION_ID, WaitingSection } from "./WaitingSection";
import { WeekNavigator } from "./WeekNavigator";
import {
	contextInScope,
	isOutsideSheet,
	isPersonalSheet,
	WORKSPACE_GROUPS_COPY,
	waitingInScope,
} from "./workspaceGroups";

export const TIME_PAGE_COPY = {
	startTimer: "Start timer",
	addTime: "Add time",
	project: "Project",
	allProjects: "Show every project",
	retry: "Try again",
	loading: "Loading your time",
} as const;

export interface TimePageSearchOptions {
	/** Replace the history entry instead of pushing one. */
	replace?: boolean;
}

export interface TimePageProps {
	search: TimePageSearch;
	/** Merges `patch` into the search (an `undefined` value drops the key). */
	onSearchChange: (
		patch: Partial<TimePageSearch>,
		options?: TimePageSearchOptions,
	) => void;
	/** The URL hash without `#` (`waiting` scrolls to Waiting for you). */
	hash?: string;
	/** "Open task in roadmap" (the route navigates). */
	onOpenTask?: (entry: TimeEntryView) => void;
	/** Tests: a fixed clock. */
	now?: Date;
}

const PAGE = "mx-auto w-full max-w-6xl space-y-4 px-4 py-4 sm:px-6 sm:py-6";
/** Returned and reopened cards whose detail (events) the page reads for their sublabel. */
const EVENT_DETAIL_MAX = 5;

const PRIMARY =
	"inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
	"inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

export function TimePage(props: TimePageProps) {
	// Everything that creates time here (Start timer, Quick add, Add time,
	// their For choices) is the open workspace's (workspaceGroups.ts).
	const { scope } = useTimeWorkspaceScope();
	return (
		<LoggingScopeProvider scope={scope}>
			<TimePageBody {...props} />
		</LoggingScopeProvider>
	);
}

function TimePageBody({
	search,
	onSearchChange,
	hash,
	onOpenTask,
	now,
}: TimePageProps) {
	const {
		workspace,
		workspaces,
		isLoading: workspacesLoading,
	} = useCurrentWorkspace();
	const myWorkspaceNames = useMemo(() => {
		const names: Record<string, string> = {};
		for (const item of workspaces ?? []) names[item.id] = item.name;
		return names;
	}, [workspaces]);
	const timeScope = useTimeWorkspaceScope();
	const scope = timeScope.scope;
	const data = useTimePageData(search, {
		now,
		names: myWorkspaceNames,
		scope,
	});
	const {
		overview,
		overviewQuery,
		canLog,
		zone,
		week,
		today,
		isCurrentWeek,
		forRef,
		forRequest,
	} = data;
	const isPhone = useIsMobile(639);
	const queryClient = useQueryClient();
	const runningRead = useRunningEntry({ enabled: false });
	const running = runningRead.entry;
	// The timer changed under the page (stopped, paused or switched on another
	// device or tab): the timer bar's poll sees it, the lists and cards don't,
	// so refresh them. A local write refreshes them itself: an optimistic stop
	// or pause still in flight is skipped, and a refetch a finished write
	// already started is joined rather than restarted (`cancelRefetch:
	// false`), so local timer actions cost no extra requests. Nothing runs
	// until the first answer arrives.
	const runningSig =
		runningRead.query.data === undefined
			? null
			: running
				? `${running.id}:${running.paused_at ?? ""}`
				: "none";
	const lastRunningSig = useRef<string | null>(null);
	useEffect(() => {
		if (runningSig === null) return;
		const previous = lastRunningSig.current;
		lastRunningSig.current = runningSig;
		if (previous === null || previous === runningSig) return;
		if (queryClient.isMutating() > 0) return;
		for (const queryKey of [
			TIME_PREFIX.myEntries,
			TIME_PREFIX.mySummary,
			TIME_PREFIX.myTimesheets,
			TIME_PREFIX.overview,
		]) {
			void queryClient.invalidateQueries(
				{ queryKey },
				{ cancelRefetch: false },
			);
		}
	}, [runningSig, queryClient]);
	const [storedView, setStoredView] = useTimeViewMode();
	// The view (D86): `?view=` wins, so a Month URL reloads as Month. A linked
	// week without a view (`?week=`, as the dashboard's "Submit last week"
	// sends) opens the list for this visit even when Month is remembered, so
	// its cards and Submit are there; stepping back to this week keeps it.
	// Otherwise the remembered view. The stored choice changes only when the
	// person picks a view.
	const [weekLinked, setWeekLinked] = useState(
		() => Boolean(search.week) && !search.view,
	);
	const listView = search.view
		? search.view === "list"
		: weekLinked || storedView === "list";
	const userTimezone = data.prefs.timezone;

	// ── Page state ──
	const [selectedDay, setSelectedDay] = useState<string | null>(null);
	const [fixSheet, setFixSheet] = useState<TimesheetSummary | null>(null);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [pickerOpen, setPickerOpen] = useState(false);
	const [manual, setManual] = useState<ManualEntryDraft | null>(null);
	const [editing, setEditing] = useState<TimeEntryView | null>(null);
	const [deleting, setDeleting] = useState<TimeEntryView | null>(null);
	const [changingFor, setChangingFor] = useState<TimeEntryView[] | null>(null);
	const [changingTask, setChangingTask] = useState<TimeEntryView | null>(null);
	const [submitting, setSubmitting] = useState<TimesheetSummary | null>(null);
	const [detail, setDetail] = useState<{
		focus: "comments" | null;
		zIndex?: number;
	}>({ focus: null });
	const [stoppingId, setStoppingId] = useState<string | null>(null);
	const stopRef = useRef<(() => void) | null>(null);

	const sheetActions = useTimesheetActions({ toastOnError: true });
	const changeTask = useChangeEntryTask();

	// A new week, For or project starts with no day picked, nothing selected
	// and no sheet being fixed.
	const filterKey = `${week.start}|${search.for ?? ""}|${search.project ?? ""}`;
	useEffect(() => {
		setSelectedDay(null);
		setSelected(new Set());
		setFixSheet(null);
	}, [filterKey]);

	// ── Derived ──
	const workspaceNames = useMemo(() => {
		const names: Record<string, string> = { ...myWorkspaceNames };
		for (const item of overview?.workspace_time_admin ?? []) {
			names[item.workspace_id] = names[item.workspace_id] ?? item.name;
		}
		return names;
	}, [myWorkspaceNames, overview?.workspace_time_admin]);
	const currentWorkspaceId = workspacesLoading
		? undefined
		: (workspace?.id ?? null);
	// This workspace's waiting rows, admin items and agreement cards.
	const rowFilter = useCallback(
		(row: Parameters<typeof waitingInScope>[0]) => waitingInScope(row, scope),
		[scope],
	);
	const hereAdmins = useMemo(
		() =>
			(overview?.workspace_time_admin ?? []).filter(
				(item) =>
					!scope.current ||
					item.workspace_id.toLowerCase() === scope.current.toLowerCase(),
			),
		[overview?.workspace_time_admin, scope],
	);
	const needsConfirm = unconfirmedAdmins(hereAdmins).length > 0;
	// The tab: Approvals only for someone who can approve here.
	const canApprove = timeScope.waitingHere > 0 || hereAdmins.length > 0;
	const hasOwnTime =
		(overview?.contexts ?? []).some((context) =>
			contextInScope(context, scope),
		) || data.entries.length > 0;
	const tab: TimeTab = resolveTimeTab({
		requested: search.tab ?? null,
		canApprove,
		hasOwnTime,
		waitingHere: timeScope.waitingHere,
		hash,
	});
	const setTab = (next: TimeTab) =>
		onSearchChange({ tab: next }, { replace: true });
	// Cards: this workspace's; agreements ("Personal & agreements") and
	// sheets of workspaces the person isn't in ("Shared with you") apart.
	const workspaceSheets = useMemo(
		() =>
			data.sheets.filter(
				(sheet) => !isPersonalSheet(sheet) && !isOutsideSheet(sheet, scope),
			),
		[data.sheets, scope],
	);
	const sharedSheets = useMemo(
		() => data.sheets.filter((sheet) => isOutsideSheet(sheet, scope)),
		[data.sheets, scope],
	);
	const personalSheets = useMemo(
		() => data.sheets.filter((sheet) => isPersonalSheet(sheet)),
		[data.sheets],
	);

	const fixQuery = useQuery({
		...timeQueries.timesheet(fixSheet?.id ?? null),
		enabled: Boolean(fixSheet),
	});
	// The sheet being fixed left Returned (resubmitted here or elsewhere):
	// the Fix filter and its banner go. An older copy of the sheet (a cached
	// read from before it was returned) doesn't count.
	useEffect(() => {
		const sheet = fixQuery.data?.sheet;
		if (!fixSheet || !sheet || sheet.id !== fixSheet.id) return;
		if (sheet.status === "returned") return;
		if (Date.parse(sheet.updated_at) < Date.parse(fixSheet.updated_at)) return;
		setFixSheet(null);
	}, [fixQuery.data, fixSheet]);
	const listEntries = useMemo(() => {
		if (fixSheet) return fixQuery.data?.entries ?? [];
		return entriesOnDay(data.entries, selectedDay, zone.timezone);
	}, [fixSheet, fixQuery.data, data.entries, selectedDay, zone.timezone]);
	const tableSheets = useMemo(
		() =>
			fixQuery.data?.sheet
				? [fixQuery.data.sheet, ...data.weekSheets]
				: data.weekSheets,
		[fixQuery.data, data.weekSheets],
	);
	const detailEntry = useMemo(() => {
		if (!search.entry) return null;
		return (
			[...data.entries, ...(fixQuery.data?.entries ?? [])].find(
				(entry) => entry.id === search.entry,
			) ?? null
		);
	}, [search.entry, data.entries, fixQuery.data]);

	const governed = Boolean(forRef && forRef.kind !== "personal");
	const personal = usePersonalWhy(
		canLog === true && !governed && onlyPersonal(overview),
	);

	// The hour-limit indicator, while one governed context is in view.
	const limitProjectId =
		governed && !search.project && !fixSheet
			? (data.entries.find((entry) => entry.project_id)?.project_id ?? null)
			: null;
	const limitPolicy = useQuery({
		...timeQueries.projectPolicy(limitProjectId, forRequest),
		enabled: Boolean(limitProjectId),
		retry: false,
	});
	const limitReadings = limitPolicy.data
		? limitReadingsFromPolicy(limitPolicy.data, {
				label: data.forName,
				weekLoggedSeconds: data.entries.reduce(
					(sum, entry) => sum + Math.max(0, entry.duration_seconds ?? 0),
					0,
				),
			})
		: [];

	const projectTitle = useMemo(() => {
		if (!search.project) return null;
		return (
			data.entries.find((entry) => entry.project_id === search.project)?.project
				?.title ?? null
		);
	}, [search.project, data.entries]);
	const myProjects = useQuery({
		...timeQueries.myProjects(data.userId),
		enabled: Boolean(search.project) && !projectTitle,
	});
	const projectLabel =
		projectTitle ??
		myProjects.data?.projects.find((project) => project.id === search.project)
			?.title ??
		null;
	// P1's plan notice is for an owner who tracks time on this workspace's
	// projects; read only when it could apply (same cached A9 list).
	const planNoticeCandidate = canLog === true && workspace?.my_role === "owner";
	const planProjects = useQuery({
		...timeQueries.myProjects(data.userId),
		enabled: planNoticeCandidate,
	});
	const logsHere =
		planNoticeCandidate &&
		logsInWorkspace(planProjects.data?.projects, workspace?.id);

	// A returned card tells a decider's reopen from a return ("Reopened by
	// Lito"), and an open card shows "Reopened by you", only from the sheet's
	// events, which `me/timesheets` doesn't carry: read the detail of each
	// returned card and of each open card that has been through a transition
	// (revision > 0: withdrawn, reopened or imported), returned first (the
	// query Fix and the review screen share, so Fix then opens from cache).
	// Such sheets are few; at most 5.
	const eventSheetIds = useMemo(
		() =>
			[
				...data.sheets.filter((sheet) => sheet.status === "returned"),
				...data.sheets.filter(
					(sheet) => sheet.status === "open" && sheet.revision > 0,
				),
			]
				.slice(0, EVENT_DETAIL_MAX)
				.map((sheet) => sheet.id),
		[data.sheets],
	);
	const eventDetails = useQueries({
		queries: eventSheetIds.map((id) => timeQueries.timesheet(id)),
	});
	const sheetEvents: Record<string, readonly TimesheetEventRow[]> = {};
	eventDetails.forEach((query, index) => {
		const events = query.data?.events;
		if (events) sheetEvents[eventSheetIds[index]] = events;
	});

	// ── Navigation ──
	const goWeek = useCallback(
		(step: number) => {
			const next = shiftWeek(week.start, zone.weekStart, step);
			onSearchChange({ week: weekParam(next, today) }, { replace: true });
		},
		[week.start, zone.weekStart, today, onSearchChange],
	);
	const goThisWeek = useCallback(() => {
		onSearchChange({ week: undefined }, { replace: true });
	}, [onSearchChange]);
	const setFor = (value: TimeForParam | undefined) => {
		onSearchChange({ for: value }, { replace: true });
	};

	const openDetail = (
		entry: TimeEntryView,
		options: { focus?: "comments"; zIndex?: number } = {},
	) => {
		setDetail({ focus: options.focus ?? null, zIndex: options.zIndex });
		onSearchChange({ entry: entry.id }, { replace: true });
	};
	const closeDetail = () => {
		setDetail({ focus: null });
		onSearchChange({ entry: undefined }, { replace: true });
	};

	// `#waiting`: scroll there once the section (and what sits above it) has loaded.
	const waitingRef = useRef<HTMLDivElement>(null);
	const scrolledTo = useRef<string | null>(null);
	const aboveLoaded =
		!data.entriesQuery.isPending && !data.sheetsQuery.isPending;
	const scrollToWaiting = useCallback(() => {
		const el =
			waitingRef.current ??
			(typeof document !== "undefined"
				? document.getElementById(WAITING_SECTION_ID)
				: null);
		if (!el) return false;
		el.scrollIntoView?.({ block: "start", behavior: "smooth" });
		el.focus?.({ preventScroll: true });
		return true;
	}, []);
	useEffect(() => {
		if (hash !== WAITING_SECTION_ID) {
			scrolledTo.current = null;
			return;
		}
		if (scrolledTo.current === hash || !overview || !aboveLoaded) return;
		if (scrollToWaiting()) scrolledTo.current = hash;
	}, [hash, overview, aboveLoaded, scrollToWaiting]);

	// ── Actions ──
	const openPicker = () => setPickerOpen(true);
	const openManual = (draft: ManualEntryDraft = {}) =>
		setManual({
			projectId: search.project ?? null,
			day: selectedDay,
			...draft,
		});

	const fixing = fixSheet
		? {
				label: timesheetCardLabel(fixSheet).text,
				period: formatPeriodRange(fixSheet.period_start, fixSheet.period_end, {
					timezone: fixSheet.timezone,
					userTimezone,
					now,
				}),
			}
		: null;
	const filtered = Boolean(
		search.for || search.project || selectedDay || fixSheet,
	);
	const pendingIds = useMemo(
		() =>
			[stoppingId, changeTask.pendingId].filter((id): id is string =>
				Boolean(id),
			),
		[stoppingId, changeTask.pendingId],
	);
	// No project to log on in this workspace: nothing to start or add.
	const loggableHere = useLoggableProjects({ scope });
	const noProjects = loggableHere.isEmpty;
	const loggable = canLog === true;
	const canCreateEntries = loggable && !noProjects;
	// Any workspace member can start a project (the sidebar's +), on web and
	// in the app alike.
	const canAddProject =
		Boolean(workspace) && isVisibleInApp("/project/new", isNativeApp());
	const noProjectsWhy = noProjects
		? TIME_EMPTY_COPY.noProjects(workspace?.name ?? "this workspace")
		: undefined;

	// ── Render ──
	const overviewError = overviewQuery.isError ? (
		<TimeReasonCard
			variant="inline"
			tone="danger"
			role="alert"
			title={timeErrorMessage(overviewQuery.error, { operation: "read" })}
			action={
				<button
					type="button"
					className={SECONDARY}
					onClick={() => void overviewQuery.refetch()}
				>
					{TIME_PAGE_COPY.retry}
				</button>
			}
		/>
	) : null;

	// One slim banner, only when something needs doing: the policy to
	// confirm, else the plan notice.
	const oneTimeCards = (
		<>
			{needsConfirm ? (
				<PolicyConfirmCard admins={hereAdmins} />
			) : (
				<TimePlanBanner
					workspace={workspace}
					downgraded={planDowngradeApplies(data.weekSheets, workspace?.id)}
					logsHere={logsHere}
				/>
			)}
			<LegacyGroupingBanner />
		</>
	);

	const modals = (
		<>
			<TaskPickerModal
				open={pickerOpen}
				onClose={() => setPickerOpen(false)}
				initialProjectId={search.project ?? null}
			/>
			<TaskPickerModal
				open={Boolean(changingTask)}
				mode="select"
				lockProject
				initialProjectId={changingTask?.project_id ?? null}
				lockedProjectTitle={changingTask?.project?.title ?? null}
				initialTaskId={changingTask?.task_id ?? null}
				initialWorkItem={
					changingTask && changingTask.work_item !== "task"
						? changingTask.work_item
						: null
				}
				title={ENTRIES_SECTION_COPY.changeTaskTitle}
				description={ENTRIES_SECTION_COPY.changeTaskDescription}
				confirmLabel={ENTRIES_SECTION_COPY.changeTaskConfirm}
				onSelect={(selection) => {
					if (changingTask) void changeTask.change(changingTask, selection);
				}}
				onClose={() => setChangingTask(null)}
			/>
			<ManualEntryModal
				open={Boolean(manual)}
				initial={manual ?? undefined}
				onClose={() => setManual(null)}
			/>
			<EditEntryModal
				open={Boolean(editing)}
				entry={editing}
				timeZone={zone.timezone}
				onClose={() => setEditing(null)}
				onChangeFor={(entry) => {
					setEditing(null);
					setChangingFor([entry]);
				}}
			/>
			<DeleteEntryModal
				open={Boolean(deleting)}
				entry={deleting}
				timeZone={zone.timezone}
				onClose={() => setDeleting(null)}
				onDeleted={(entryId) => {
					if (search.entry === entryId) closeDetail();
					setSelected((current) => {
						if (!current.has(entryId)) return current;
						const next = new Set(current);
						next.delete(entryId);
						return next;
					});
				}}
			/>
			<ChangeForDialog
				open={Boolean(changingFor)}
				entries={changingFor ?? []}
				timesheets={tableSheets}
				timeZone={zone.timezone}
				onClose={() => setChangingFor(null)}
				onDone={() => setSelected(new Set())}
			/>
			{submitting ? (
				<SubmitSheetDialog
					open
					sheet={submitting}
					onClose={() => setSubmitting(null)}
					// Resubmitting the sheet being fixed ends the Fix filter.
					onSubmitted={(row) =>
						setFixSheet((current) => (current?.id === row.id ? null : current))
					}
					workspaceName={
						submitting.policy_workspace_id
							? (workspaceNames[submitting.policy_workspace_id] ?? null)
							: null
					}
					now={now}
					userTimezone={userTimezone}
				/>
			) : null}
			<TimeEntryDetailModal
				entryId={search.entry ?? null}
				entry={detailEntry}
				mode="mine"
				timeZone={zone.timezone}
				focus={detail.focus}
				sheets={tableSheets}
				zIndex={detail.zIndex}
				onClose={closeDetail}
				onEdit={(entry) => {
					closeDetail();
					setEditing(entry);
				}}
				onDelete={(entry) => {
					closeDetail();
					setDeleting(entry);
				}}
			/>
		</>
	);

	// Overview still loading: the workspace's Time gate is unknown.
	if (!overview && !overviewQuery.isError) {
		return (
			<div className={PAGE} aria-busy="true">
				<TimePageHeader />
				<p className="sr-only" role="status">
					{TIME_PAGE_COPY.loading}
				</p>
				<div className="h-14 animate-pulse rounded-2xl border border-border bg-muted/50" />
				<div className="h-20 animate-pulse rounded-2xl border border-border bg-muted/40" />
				<div className="h-48 animate-pulse rounded-2xl border border-border bg-muted/30" />
				{modals}
			</div>
		);
	}

	// ── Not set up in this workspace ──
	if (timeScope.visible === false && overview) {
		return (
			<div className={PAGE}>
				<TimePageHeader />
				<div className="contents">
					<TimerBar
						variant="full"
						stickyOnMobile={false}
						onChangeFor={(entry) => setChangingFor([entry])}
					/>
				</div>
				<TimeNotSetUp
					workspaceName={timeScope.workspaceName}
					workspaceSlug={workspace?.slug ?? null}
				/>
				{modals}
			</div>
		);
	}

	// ── The page ──
	const waitingCount = timeScope.waitingHere;
	return (
		<div className={cn(PAGE, "pb-28 sm:pb-8")}>
			<TimePageHeader
				action={
					hereAdmins[0] ? <TimePolicyButton admin={hereAdmins[0]} /> : null
				}
			/>
			{canApprove ? (
				<TimeTabs value={tab} approvalsCount={waitingCount} onChange={setTab} />
			) : null}
			{overviewError}
			{oneTimeCards}

			{/* The running timer; the bar renders nothing while idle but keeps the poll. */}
			<div
				className={
					running ? "sticky top-app-header z-30 sm:static" : "contents"
				}
			>
				<TimerBar
					variant="full"
					stickyOnMobile={false}
					onChangeFor={(entry) => setChangingFor([entry])}
				/>
			</div>
			{running ? (
				<TimerStopBridge stopRef={stopRef} onStopping={setStoppingId} />
			) : null}

			{tab === "approvals" ? (
				<div className="space-y-6" role="tabpanel" data-testid="time-approvals">
					<WaitingSection
						ref={waitingRef}
						approverMode
						count={waitingCount}
						emptyText={TIME_EMPTY_COPY.caughtUp}
						rowFilter={rowFilter}
						currentWorkspaceId={currentWorkspaceId}
						floatingBar={!isPhone}
						now={now}
						userTimezone={userTimezone}
					/>
					<DecidedList
						rowFilter={rowFilter}
						currentWorkspaceId={currentWorkspaceId}
						now={now}
						userTimezone={userTimezone}
					/>
				</div>
			) : (
				<>
					<div
						className="flex flex-wrap items-center gap-2"
						data-testid="time-toolbar"
					>
						{loggable ? (
							<div className="hidden items-center gap-2 sm:flex">
								<button
									type="button"
									className={PRIMARY}
									onClick={openPicker}
									disabled={noProjects}
									title={noProjectsWhy}
								>
									<Play
										className="h-3.5 w-3.5 fill-current"
										aria-hidden="true"
									/>
									{TIME_PAGE_COPY.startTimer}
								</button>
								<button
									type="button"
									className={SECONDARY}
									onClick={() => openManual()}
									disabled={noProjects}
									title={noProjectsWhy}
								>
									<Plus className="h-3.5 w-3.5" aria-hidden="true" />
									{TIME_PAGE_COPY.addTime}
								</button>
							</div>
						) : null}
						<div className="ml-auto flex flex-wrap items-center gap-2">
							{search.project ? (
								<span
									className="inline-flex max-w-[16rem] items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground"
									data-testid="project-filter"
								>
									<span className="text-muted-foreground">
										{TIME_PAGE_COPY.project}:
									</span>
									<span className="truncate font-semibold">
										{projectLabel ?? "…"}
									</span>
									<button
										type="button"
										aria-label={TIME_PAGE_COPY.allProjects}
										title={TIME_PAGE_COPY.allProjects}
										onClick={() =>
											onSearchChange({ project: undefined }, { replace: true })
										}
										className="ml-0.5 rounded px-1 text-muted-foreground hover:bg-background hover:text-foreground"
									>
										×
									</button>
								</span>
							) : null}
							<ForFilter
								value={search.for}
								options={data.forOptions}
								onChange={setFor}
								personal={personal}
							/>
							<TimeViewToggle
								value={listView ? "list" : "month"}
								onChange={(mode) => {
									setWeekLinked(false);
									setStoredView(mode);
									// Month goes in the URL so a reload keeps it (D86); List is
									// the default reading, so its URL stays clean.
									onSearchChange(
										{ view: mode === "month" ? "month" : undefined },
										{ replace: true },
									);
								}}
							/>
						</div>
					</div>

					{listView ? (
						<>
							<div className="space-y-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
								<WeekNavigator
									week={week}
									isCurrentWeek={isCurrentWeek}
									onPrevious={() => goWeek(-1)}
									onNext={() => goWeek(1)}
									onThisWeek={goThisWeek}
									zoneText={data.zoneText}
									settings={<TimePrefsMenu />}
								/>
								<DayStrip
									entries={data.entries}
									week={week}
									timeZone={zone.timezone}
									today={today}
									selectedDay={selectedDay}
									onSelectDay={(day) => {
										setFixSheet(null);
										setSelectedDay(day);
									}}
									loading={data.entriesQuery.isPending}
									zoneText={data.zoneText}
									nowMs={now ? now.getTime() : undefined}
								/>
							</div>

							<LimitBanner readings={limitReadings} />

							<TimesheetCardsSection
								sheets={workspaceSheets}
								loading={data.sheetsQuery.isPending}
								error={data.sheetsQuery.isError ? data.sheetsQuery.error : null}
								onRetry={() => void data.sheetsQuery.refetch()}
								onSubmit={setSubmitting}
								onFix={(sheet) => {
									setSelectedDay(null);
									setFixSheet(sheet);
								}}
								onWithdraw={(sheet) => void sheetActions.withdraw(sheet)}
								isBusy={(id) => sheetActions.isPending(undefined, id)}
								names={data.sheetNames}
								events={sheetEvents}
								workspaceNames={workspaceNames}
								fixingId={fixSheet?.id ?? null}
								reminderDays={data.sheetReminders}
								now={now}
								userTimezone={userTimezone}
							/>

							{scope.isDefault && personalSheets.length > 0 ? (
								<section
									data-testid="time-personal-section"
									aria-label={WORKSPACE_GROUPS_COPY.personal}
									className="space-y-2"
								>
									<h2 className="text-sm font-semibold text-foreground">
										{WORKSPACE_GROUPS_COPY.personal}
									</h2>
									<TimesheetCardsSection
										sheets={personalSheets}
										onSubmit={setSubmitting}
										onFix={(sheet) => {
											setSelectedDay(null);
											setFixSheet(sheet);
										}}
										onWithdraw={(sheet) => void sheetActions.withdraw(sheet)}
										isBusy={(id) => sheetActions.isPending(undefined, id)}
										names={data.sheetNames}
										events={sheetEvents}
										workspaceNames={workspaceNames}
										fixingId={fixSheet?.id ?? null}
										reminderDays={data.sheetReminders}
										now={now}
										userTimezone={userTimezone}
									/>
								</section>
							) : null}
							{scope.isDefault && sharedSheets.length > 0 ? (
								<section
									data-testid="time-shared-section"
									aria-label={WORKSPACE_GROUPS_COPY.shared}
									className="space-y-2"
								>
									<h2 className="text-sm font-semibold text-foreground">
										{WORKSPACE_GROUPS_COPY.shared}
									</h2>
									<TimesheetCardsSection
										sheets={sharedSheets}
										onSubmit={setSubmitting}
										onFix={(sheet) => {
											setSelectedDay(null);
											setFixSheet(sheet);
										}}
										onWithdraw={(sheet) => void sheetActions.withdraw(sheet)}
										isBusy={(id) => sheetActions.isPending(undefined, id)}
										names={data.sheetNames}
										events={sheetEvents}
										workspaceNames={workspaceNames}
										fixingId={fixSheet?.id ?? null}
										reminderDays={data.sheetReminders}
										now={now}
										userTimezone={userTimezone}
									/>
								</section>
							) : null}

							<EntriesSection
								entries={listEntries}
								loading={
									fixSheet ? fixQuery.isPending : data.entriesQuery.isPending
								}
								error={
									fixSheet
										? fixQuery.isError
											? fixQuery.error
											: null
										: data.entriesQuery.isError
											? data.entriesQuery.error
											: null
								}
								onRetry={() =>
									void (fixSheet
										? fixQuery.refetch()
										: data.entriesQuery.refetch())
								}
								timeZone={zone.timezone}
								sheets={tableSheets}
								day={
									selectedDay && !fixSheet
										? {
												date: selectedDay,
												label: formatLocalDay(selectedDay, {
													weekday: true,
													now,
												}),
											}
										: null
								}
								onClearDay={() => setSelectedDay(null)}
								fixing={fixing}
								onClearFix={() => setFixSheet(null)}
								empty={
									noProjects && !filtered && loggable ? (
										<TimeEmptyState
											kind="no_projects"
											label={workspace?.name ?? undefined}
											action={
												canAddProject ? (
													<Link
														to="/project/new"
														search={{ roadmapId: undefined }}
														className={PRIMARY}
													>
														{TIME_EMPTY_COPY.createProject}
													</Link>
												) : (
													<span>{TIME_EMPTY_COPY.askOwner}</span>
												)
											}
										/>
									) : (
										<TimeEmptyState
											{...pickTimeEmptyState(overview, { filtered })}
											onStartTimer={canCreateEntries ? openPicker : undefined}
											onAddTime={
												canCreateEntries ? () => openManual() : undefined
											}
										/>
									)
								}
								pendingIds={pendingIds}
								selectedIds={selected}
								onSelectionChange={setSelected}
								onOpenEntry={(entry, options) =>
									openDetail(entry, { focus: options?.focus })
								}
								// Stop only the row's own timer. A row still showing a timer
								// that stopped or switched elsewhere is stale: refresh it,
								// never stop a timer the person didn't click.
								onStop={(entry) => {
									if (running?.id === entry.id) stopRef.current?.();
									else void invalidateTime(queryClient, "entry");
								}}
								onEdit={setEditing}
								onChangeTask={setChangingTask}
								onChangeFor={setChangingFor}
								onDelete={setDeleting}
								onOpenTask={onOpenTask}
								canOpenTask={(entry) =>
									Boolean(
										onOpenTask &&
											entry.task_id &&
											entry.project_id &&
											entry.content !== "hidden",
									)
								}
							/>
						</>
					) : (
						<TimeMonthView
							timeZone={zone.timezone}
							weekStart={zone.weekStart}
							month={search.week ?? today}
							// The month's ‹ › pass its 1st and keep `?view=month`, so a
							// reload stays in Month (D86). Back in this month the week
							// drops, so List opens on this week.
							onMonthChange={(date) =>
								onSearchChange(
									{
										week:
											date.slice(0, 7) === today.slice(0, 7) ? undefined : date,
										view: "month",
									},
									{ replace: true },
								)
							}
							forRef={forRequest}
							projectId={search.project ?? null}
							timesheets={data.weekSheets}
							onOpenEntry={(entry, ctx) =>
								openDetail(entry, { focus: ctx.focus, zIndex: ctx.zIndex })
							}
							onAddTimeForDay={
								canCreateEntries
									? (date) => openManual({ day: date })
									: undefined
							}
							onStartTimer={canCreateEntries ? openPicker : undefined}
						/>
					)}

					{canCreateEntries ? (
						<TimeMobileFab
							onStartTimer={openPicker}
							onAddTime={() => openManual()}
						/>
					) : null}
				</>
			)}
			{modals}
		</div>
	);
}

/** A workspace where the person has no time: a calm line, not a 404. */
function TimeNotSetUp({
	workspaceName,
	workspaceSlug,
}: {
	workspaceName: string | null;
	workspaceSlug: string | null;
}) {
	const name = workspaceName?.trim() || "this workspace";
	return (
		<div
			role="status"
			data-testid="time-not-set-up"
			className="rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center text-card-foreground"
		>
			<div
				aria-hidden="true"
				className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
			>
				<Clock className="h-5 w-5" />
			</div>
			<p className="mx-auto max-w-md text-sm font-medium text-foreground">
				{nativeSafe(WORKSPACE_GROUPS_COPY.notSetUp(name))}
			</p>
			<p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
				{WORKSPACE_GROUPS_COPY.notSetUpDetail}
			</p>
			{workspaceSlug ? (
				<div className="mt-5 flex justify-center">
					<Link
						to="/w/$workspaceSlug/dashboard"
						params={{ workspaceSlug }}
						className={SECONDARY}
					>
						{WORKSPACE_GROUPS_COPY.dashboard}
					</Link>
				</div>
			) : null}
		</div>
	);
}

/**
 * Stops the running timer from a table row. A separate component so the
 * timer's one-second tick re-renders only this (it renders nothing), and with
 * `enabled: false` it reads the running timer without adding a poll.
 */
function TimerStopBridge({
	stopRef,
	onStopping,
}: {
	stopRef: { current: (() => void) | null };
	onStopping: (entryId: string | null) => void;
}) {
	const timer = useActiveTimer({ enabled: false });
	stopRef.current = timer.stop;
	const stoppingId = timer.isStopping ? timer.runningEntryId : null;
	useEffect(() => {
		onStopping(stoppingId);
	}, [stoppingId, onStopping]);
	useEffect(
		() => () => {
			stopRef.current = null;
			onStopping(null);
		},
		[stopRef, onStopping],
	);
	return null;
}
