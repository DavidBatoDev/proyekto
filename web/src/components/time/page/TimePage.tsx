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
// Approver mode (`overview.approver_mode`, L36): the header's Start timer
// pill, Waiting for you, Decided, and the policy cards when nothing waits.
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
// so nothing here refetches by hand.

import { useQuery } from "@tanstack/react-query";
import { Play, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { timeErrorMessage } from "@/lib/timeErrors";
import { formatLocalDay, formatPeriodRange } from "@/lib/timeFormat";
import { shiftWeek } from "@/lib/timePeriods";
import type { TimeForParam, TimePageSearch } from "@/lib/timeSearch";
import { cn } from "@/lib/utils";
import { timeQueries } from "@/queries/time";
import type { TimeEntryView, TimesheetSummary } from "@/services/time.types";
import { TimeMonthView } from "../calendar/TimeMonthView";
import { TimeViewToggle, useTimeViewMode } from "../calendar/TimeViewToggle";
import { ChangeForDialog } from "../edit/ChangeForDialog";
import { DeleteEntryModal } from "../edit/DeleteEntryModal";
import { EditEntryModal } from "../edit/EditEntryModal";
import { TimeEntryDetailModal } from "../entries/TimeEntryDetailModal";
import {
	type ManualEntryDraft,
	ManualEntryModal,
} from "../forms/ManualEntryModal";
import { QuickAddBar } from "../forms/QuickAddBar";
import { TaskPickerModal } from "../forms/TaskPickerModal";
import { TimeReasonCard } from "../shared/TimeReasonCard";
import { SubmitSheetDialog } from "../sheets/SubmitSheetDialog";
import { timesheetCardLabel } from "../sheets/TimesheetCard";
import { useTimesheetActions } from "../sheets/useTimesheetActions";
import { TimerBar } from "../timer/TimerBar";
import { useActiveTimer, useRunningEntry } from "../timer/useActiveTimer";
import { ApproverModeView } from "./ApproverModeView";
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
	planDowngradeApplies,
	TimePlanBanner,
} from "./LimitBanner";
import { PolicyConfirmCard } from "./PolicyConfirmCard";
import { pickTimeEmptyState, TimeEmptyState } from "./TimeEmptyStates";
import { TimeMobileFab } from "./TimeMobileFab";
import { TimePageHeader } from "./TimePageHeader";
import { TimePrefsMenu } from "./TimePrefsMenu";
import { TimesheetCardsSection } from "./TimesheetCardsSection";
import {
	entriesOnDay,
	onlyPersonal,
	useTimePageData,
	weekParam,
} from "./useTimePageData";
import { WAITING_SECTION_ID, WaitingSection } from "./WaitingSection";
import { WeekNavigator } from "./WeekNavigator";

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

const PRIMARY =
	"inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
	"inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

export function TimePage({
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
	const data = useTimePageData(search, { now, names: myWorkspaceNames });
	const {
		overview,
		overviewQuery,
		approverMode,
		canLog,
		zone,
		week,
		today,
		isCurrentWeek,
		forRef,
		forRequest,
	} = data;
	const isPhone = useIsMobile(639);
	const running = useRunningEntry({ enabled: false }).entry;
	const [view, setView] = useTimeViewMode();
	// A linked week (`?week=`, as the dashboard's "Submit last week" sends)
	// opens the list for this visit even when Month is remembered, so its
	// cards and Submit are there. The stored choice stays until the person
	// picks a view.
	const [weekLinked, setWeekLinked] = useState(() => Boolean(search.week));
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
		approverMode === false &&
			canLog === true &&
			!governed &&
			onlyPersonal(overview),
	);

	// The hour-limit indicator, while one governed context is in view.
	const limitProjectId =
		governed && !search.project && !fixSheet
			? (data.entries.find((entry) => entry.project_id)?.project_id ?? null)
			: null;
	const limitPolicy = useQuery({
		...timeQueries.projectPolicy(limitProjectId, forRequest),
		enabled: Boolean(limitProjectId) && approverMode === false,
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
		approverMode === true ||
		(!data.entriesQuery.isPending && !data.sheetsQuery.isPending);
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
	const loggable = canLog === true;

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

	const oneTimeCards = (
		<>
			<PolicyConfirmCard admins={overview?.workspace_time_admin} />
			{approverMode === false ? (
				<>
					<LegacyGroupingBanner />
					<TimePlanBanner
						workspace={workspace}
						downgraded={planDowngradeApplies(data.weekSheets, workspace?.id)}
					/>
				</>
			) : null}
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

	// Overview still loading: the mode is unknown, so no week flashes for an approver.
	if (approverMode === null && !overviewQuery.isError) {
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

	// ── Approver mode ──
	if (approverMode === true && overview) {
		return (
			<div className={PAGE}>
				<TimePageHeader
					action={
						canLog === false ? null : (
							<TimerBar
								variant="pill"
								onStartTimer={openPicker}
								onChangeFor={(entry) => setChangingFor([entry])}
							/>
						)
					}
				/>
				{overviewError}
				{oneTimeCards}
				<ApproverModeView
					overview={overview}
					currentWorkspaceId={currentWorkspaceId}
					floatingBar={!isPhone}
					now={now}
					userTimezone={userTimezone}
				/>
				{modals}
			</div>
		);
	}

	// ── Normal mode ──
	const waitingCount = overview?.approvals_waiting ?? 0;
	const listView = view === "list" || weekLinked;
	return (
		<div className={cn(PAGE, "pb-28 sm:pb-8")}>
			<TimePageHeader
				waitingCount={waitingCount}
				onShowWaiting={() => {
					scrollToWaiting();
				}}
			/>
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

			<div
				className="flex flex-wrap items-center gap-2"
				data-testid="time-toolbar"
			>
				{loggable ? (
					<div className="hidden items-center gap-2 sm:flex">
						<button type="button" className={PRIMARY} onClick={openPicker}>
							<Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
							{TIME_PAGE_COPY.startTimer}
						</button>
						<button
							type="button"
							className={SECONDARY}
							onClick={() => openManual()}
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
							setView(mode);
						}}
					/>
				</div>
			</div>

			{loggable && listView ? (
				<div className="hidden sm:block">
					<QuickAddBar projectId={search.project ?? null} day={selectedDay} />
				</div>
			) : null}

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
						sheets={data.sheets}
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
						workspaceNames={workspaceNames}
						fixingId={fixSheet?.id ?? null}
						now={now}
						userTimezone={userTimezone}
					/>

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
							void (fixSheet ? fixQuery.refetch() : data.entriesQuery.refetch())
						}
						timeZone={zone.timezone}
						sheets={tableSheets}
						day={
							selectedDay && !fixSheet
								? {
										date: selectedDay,
										label: formatLocalDay(selectedDay, { weekday: true, now }),
									}
								: null
						}
						onClearDay={() => setSelectedDay(null)}
						fixing={fixing}
						onClearFix={() => setFixSheet(null)}
						empty={
							<TimeEmptyState {...pickTimeEmptyState(overview, { filtered })} />
						}
						pendingIds={pendingIds}
						selectedIds={selected}
						onSelectionChange={setSelected}
						onOpenEntry={(entry, options) =>
							openDetail(entry, { focus: options?.focus })
						}
						onStop={() => stopRef.current?.()}
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
					// The month's ‹ › pass its 1st; back in this month the URL
					// stays clean, so List opens on this week.
					onMonthChange={(date) =>
						onSearchChange(
							{
								week: date.slice(0, 7) === today.slice(0, 7) ? undefined : date,
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
						loggable ? (date) => openManual({ day: date }) : undefined
					}
					onStartTimer={loggable ? openPicker : undefined}
				/>
			)}

			<WaitingSection
				ref={waitingRef}
				count={waitingCount}
				currentWorkspaceId={currentWorkspaceId}
				floatingBar={!isPhone}
				now={now}
				userTimezone={userTimezone}
			/>

			{loggable ? (
				<TimeMobileFab
					onStartTimer={openPicker}
					onAddTime={() => openManual()}
				/>
			) : null}
			{modals}
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
