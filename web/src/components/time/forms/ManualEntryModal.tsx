// web/src/components/time/forms/ManualEntryModal.tsx
//
// "Add time" with exact in and out times and breaks (ux.md › Quick add › More
// options), a port of `team-time/TeamTimeModals` › ManualLogModal onto
// `/api/time`:
//
// - Project (A9: only projects the person can log on), then a task or a preset
//   ("◦ Meeting"), with "Browse tasks" opening the task picker.
// - For, as the For chip rules say: one option is a read-only chip; 2+ show the
//   radio list in place (agreements first, "Use for new time on this project"),
//   and the button names the choice ("Add for Acme Corp").
// - Start and end are wall-clock times in the context's timezone (the
//   context's policy, or the person's own for "Just me"); the start defaults
//   to the end of that day's last entry, or 09:00.
// - Inline, before anything is sent: "Manual time is off in your agreement
//   with Acme." (MANUAL_ENTRIES_DISABLED) and "Prodigitality accepts time up
//   to 7 days back." (RETROACTIVE_WINDOW). The server's own refusals, and a
//   submitted week's inline Withdraw, show in the same place.
//
// Also exports `EntryFormNotice`, the inline line both forms share.

import { useQuery } from "@tanstack/react-query";
import { ListTree, Loader2, Save } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { DateTimeField } from "@/components/common/DateTimeField";
import { Dropdown } from "@/components/common/Dropdown";
import { deviceTimeZone, formatDurationText } from "@/lib/timeFormat";
import { localDate, todayIn } from "@/lib/timePeriods";
import { cn } from "@/lib/utils";
import { timeQueries } from "@/queries/time";
import type {
	EntryWithWarnings,
	LoggingForRequest,
	PresetWorkItem,
	ProjectTaskOption,
} from "@/services/time.types";
import {
	CANCEL_BUTTON,
	CLOSE_BUTTON,
	FOR_LABEL,
	WITHDRAW_BUTTON,
} from "../for/forCopy";
import {
	ForField,
	forActionLabel,
	LoggableProjectsError,
	loggableProjectsFailed,
	presetLabel,
	TaskPickerModal,
	taskTitle,
} from "./TaskPickerModal";
import {
	type CreateEntryFlow,
	forRequestFields,
	fromWallClock,
	manualEntryRule,
	toWallClock,
	useCreateEntry,
	useDefaultStart,
	useEntryContext,
} from "./useCreateEntry";
import { projectTitle, useLoggableProjects } from "./useLoggableProjects";

// ── Copy ────────────────────────────────────────────────────────────────────

export const MANUAL_ENTRY_COPY = {
	title: "Add time",
	description: "Add time you've already worked.",
	project: "Project",
	pickProject: "Select a project…",
	work: "Task or preset",
	pickWork: "Select a task or preset…",
	loadingWork: "Loading tasks…",
	browse: "Browse tasks",
	start: "Start",
	end: "End",
	break: "Break (minutes)",
	note: "Note (optional)",
	save: "Add time",
	endBeforeStart: "The end time must be after the start time.",
	breakTooLong:
		"The break is as long as the whole block, so there's no time left to add.",
} as const;

/** "Times are in Asia/Manila." (only when that isn't the device's timezone). */
export function timezoneHint(
	tz: string,
	deviceTz: string = deviceTimeZone(),
): string | null {
	return tz === deviceTz ? null : `Times are in ${tz}.`;
}

/** "1h 30m added" / "1h 30m minus 15m break = 1h 15m added". */
export function durationLine(grossSeconds: number, breakSeconds: number) {
	const net = Math.max(0, grossSeconds - breakSeconds);
	if (breakSeconds <= 0) return `${formatDurationText(net)} added`;
	return `${formatDurationText(grossSeconds)} minus ${formatDurationText(
		breakSeconds,
	)} break = ${formatDurationText(net)} added`;
}

/** The work field's value: `task:<id>` or `preset:<item>`. */
export type WorkValue = `task:${string}` | `preset:${PresetWorkItem}` | "";

export function workValue(input: {
	taskId?: string | null;
	workItem?: PresetWorkItem | null;
}): WorkValue {
	if (input.taskId) return `task:${input.taskId}`;
	if (input.workItem) return `preset:${input.workItem}`;
	return "";
}

export function parseWorkValue(value: string): {
	taskId: string | null;
	workItem: PresetWorkItem | null;
} {
	if (value.startsWith("task:"))
		return { taskId: value.slice(5), workItem: null };
	if (value.startsWith("preset:")) {
		return { taskId: null, workItem: value.slice(7) as PresetWorkItem };
	}
	return { taskId: null, workItem: null };
}

/** Presets first ("◦ Meeting"), then tasks as "Epic › Task". */
export function workOptions(
	presets: readonly PresetWorkItem[],
	tasks: readonly ProjectTaskOption[],
): Array<{ value: string; label: string }> {
	return [
		...presets.map((preset) => ({
			value: `preset:${preset}`,
			label: `◦ ${presetLabel(preset)}`,
		})),
		...tasks.map((task) => ({
			value: `task:${task.id}`,
			label: task.epic_title?.trim()
				? `${task.epic_title.trim()} › ${taskTitle(task)}`
				: taskTitle(task),
		})),
	];
}

// ── Inline notices (shared by the forms) ────────────────────────────────────

/** The inline line under a form: a refusal, the locked sheet with Withdraw, or a hint. */
export function EntryFormNotice({
	flow,
	rule,
	hint,
	className,
}: {
	flow: CreateEntryFlow;
	/** The pre-send reason (manual time off, retroactive window). */
	rule?: string | null;
	/** A quieter line (duration hint, the interval preview). */
	hint?: ReactNode;
	className?: string;
}) {
	const { state, isPending } = flow;
	if (state.status === "locked" && state.locked) {
		const locked = state.locked;
		return (
			<div
				role="alert"
				className={cn(
					"flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground",
					className,
				)}
			>
				<span className="min-w-0 flex-1">{locked.message}</span>
				{state.error ? (
					<span className="w-full text-destructive">{state.error.message}</span>
				) : null}
				{locked.canWithdraw ? (
					<button
						type="button"
						onClick={() => void flow.withdrawAndRetry()}
						disabled={isPending}
						className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
					>
						{locked.withdrawing ? (
							<Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
						) : null}
						{WITHDRAW_BUTTON}
					</button>
				) : (
					<button
						type="button"
						onClick={flow.reset}
						className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
					>
						{CLOSE_BUTTON}
					</button>
				)}
			</div>
		);
	}
	const message =
		state.status === "error" && state.error ? state.error.message : null;
	if (message) {
		return (
			<p
				role="alert"
				className={cn(
					"rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-foreground",
					className,
				)}
			>
				{message}
			</p>
		);
	}
	if (rule) {
		return (
			<p
				role="status"
				className={cn(
					"rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground",
					className,
				)}
				data-testid="entry-rule"
			>
				{rule}
			</p>
		);
	}
	if (hint) {
		return (
			<p className={cn("text-xs text-muted-foreground", className)}>{hint}</p>
		);
	}
	return null;
}

// ── The modal ───────────────────────────────────────────────────────────────

/** What the form opens with (quick add's "More options", a calendar day). */
export interface ManualEntryDraft {
	projectId?: string | null;
	taskId?: string | null;
	workItem?: PresetWorkItem | null;
	/** A day (`YYYY-MM-DD`, context timezone) whose default start to use. */
	day?: string | null;
	/** Exact instants (ISO); they win over `day`. */
	startedAt?: string | null;
	endedAt?: string | null;
	breakMinutes?: number;
	note?: string | null;
	/** A For choice already made (2+ options); the only option is never passed. */
	loggingFor?: LoggingForRequest | null;
}

export interface ManualEntryModalProps {
	open: boolean;
	onClose: () => void;
	initial?: ManualEntryDraft;
	onCreated?: (entry: EntryWithWarnings) => void;
	zIndex?: number;
}

export function ManualEntryModal(props: ManualEntryModalProps) {
	// Mounted only while open, so every opening starts from `initial`.
	if (!props.open) return null;
	return <ManualEntryForm {...props} />;
}

const LABEL =
	"block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

function ManualEntryForm({
	onClose,
	initial = {},
	onCreated,
	zIndex = 1200,
}: ManualEntryModalProps) {
	const breakId = useId();
	const noteId = useId();
	const projects = useLoggableProjects({
		preferredProjectId: initial.projectId,
	});
	const [projectId, setProjectId] = useState<string | null>(
		initial.projectId ?? null,
	);
	// The default project once the list is in, also when the one passed in is
	// not loggable (A9 lists only projects with an option).
	const loaded = projects.query.isSuccess;
	const loggable = projectId ? projects.byId.has(projectId) : false;
	useEffect(() => {
		if (projectId && (loggable || !loaded)) return;
		if (projects.defaultProjectId && projects.defaultProjectId !== projectId) {
			// A task of the project passed in belongs to that project only.
			if (projectId) setWork("");
			setProjectId(projects.defaultProjectId);
		}
	}, [projectId, loaded, loggable, projects.defaultProjectId]);

	const [work, setWork] = useState<string>(workValue(initial));
	const [browseOpen, setBrowseOpen] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const workItems = useQuery(timeQueries.workItems(projectId));
	const options = useMemo(
		() =>
			workOptions(workItems.data?.presets ?? [], workItems.data?.tasks ?? []),
		[workItems.data],
	);

	const ctx = useEntryContext(projectId, { initialFor: initial.loggingFor });
	const { forChoice, policy, timezone } = ctx;

	// Times: while untouched they follow the defaults in the current timezone.
	const [touched, setTouched] = useState(false);
	const [startText, setStartText] = useState("");
	const [endText, setEndText] = useState("");
	const exact = Boolean(initial.startedAt);
	const { start: defaultStart } = useDefaultStart({
		day: exact ? null : (initial.day ?? todayIn(timezone)),
		timezone,
	});
	const seededStart = exact
		? new Date(initial.startedAt as string)
		: defaultStart;
	const seededEnd = initial.endedAt
		? new Date(initial.endedAt)
		: seededStart
			? new Date(seededStart.getTime() + 3600_000)
			: null;
	const shownStart = touched ? startText : toWallClock(seededStart, timezone);
	const shownEnd = touched ? endText : toWallClock(seededEnd, timezone);
	const editStart = (value: string) => {
		if (!touched) setEndText(shownEnd);
		setTouched(true);
		setStartText(value);
	};
	const editEnd = (value: string) => {
		if (!touched) setStartText(shownStart);
		setTouched(true);
		setEndText(value);
	};

	const [breakMinutes, setBreakMinutes] = useState(
		Math.max(0, Math.round(initial.breakMinutes ?? 0)),
	);
	const [note, setNote] = useState(initial.note ?? "");

	const startAt = fromWallClock(shownStart, timezone);
	const endAt = fromWallClock(shownEnd, timezone);
	const validTimes = Boolean(
		startAt && endAt && endAt.getTime() > startAt.getTime(),
	);
	const grossSeconds =
		validTimes && startAt && endAt
			? Math.floor((endAt.getTime() - startAt.getTime()) / 1000)
			: 0;
	const breakSeconds = breakMinutes * 60;
	const breakTooLong = validTimes && breakSeconds >= grossSeconds;
	const day = startAt ? localDate(startAt, timezone) : null;
	const rule = manualEntryRule({
		policy,
		option: forChoice.option,
		day,
		timezone,
	});
	const min = rule.floor ? `${rule.floor}T00:00` : undefined;

	const flow = useCreateEntry({
		onCreated: (entry) => {
			onCreated?.(entry);
			onClose();
		},
	});
	const busy = flow.isPending;
	const parsed = parseWorkValue(work);

	const canSave =
		Boolean(projectId) &&
		Boolean(parsed.taskId || parsed.workItem) &&
		validTimes &&
		!breakTooLong &&
		!rule.blocked &&
		!forChoice.isLoading &&
		// The context's timezone and rules arrive with its policy.
		!ctx.policyLoading &&
		forChoice.mode !== "none" &&
		!forChoice.needsChoice &&
		!busy;

	const save = async () => {
		if (!canSave || !projectId || !startAt || !endAt) return;
		const outcome = await flow.create({
			projectId,
			taskId: parsed.taskId,
			workItem: parsed.workItem,
			startedAt: startAt.toISOString(),
			endedAt: endAt.toISOString(),
			breakSeconds,
			note,
			...forRequestFields(forChoice),
			retroactiveDays: policy?.retroactive_days ?? null,
		});
		if (outcome === "pick") setPickerOpen(true);
	};

	const changeProject = (id: string) => {
		if (id === projectId) return;
		setProjectId(id);
		setWork("");
		setPickerOpen(false);
		flow.reset();
	};

	const timeError =
		shownStart && shownEnd && !validTimes
			? MANUAL_ENTRY_COPY.endBeforeStart
			: breakTooLong
				? MANUAL_ENTRY_COPY.breakTooLong
				: null;
	const tzHint = timezoneHint(timezone);
	const pickError =
		flow.state.status === "pick" ? (flow.state.error?.message ?? null) : null;

	return (
		<>
			<AppDialog
				open
				onClose={onClose}
				busy={busy}
				size="md"
				zIndex={zIndex}
				title={MANUAL_ENTRY_COPY.title}
				description={MANUAL_ENTRY_COPY.description}
				footer={
					<>
						<button
							type="button"
							onClick={onClose}
							disabled={busy}
							className="rounded-lg border border-input px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
						>
							{CANCEL_BUTTON}
						</button>
						<button
							type="button"
							onClick={() => void save()}
							disabled={!canSave}
							className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{busy ? (
								<Loader2
									className="h-3.5 w-3.5 animate-spin"
									aria-hidden="true"
								/>
							) : (
								<Save className="h-3.5 w-3.5" aria-hidden="true" />
							)}
							{forActionLabel(forChoice, "add", MANUAL_ENTRY_COPY.save)}
						</button>
					</>
				}
			>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<span className={LABEL}>{MANUAL_ENTRY_COPY.project}</span>
						{loggableProjectsFailed(projects) ? (
							<LoggableProjectsError projects={projects} />
						) : null}
						<Dropdown
							value={projectId ?? ""}
							options={projects.projects.map((project) => ({
								value: project.id,
								label: projectTitle(project),
							}))}
							onChange={changeProject}
							disabled={busy}
							placeholder={MANUAL_ENTRY_COPY.pickProject}
							ariaLabel={MANUAL_ENTRY_COPY.project}
						/>
					</div>

					<div className="space-y-1.5">
						<div className="flex items-center justify-between gap-2">
							<span className={LABEL}>{MANUAL_ENTRY_COPY.work}</span>
							<button
								type="button"
								onClick={() => setBrowseOpen(true)}
								disabled={busy}
								className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
							>
								<ListTree className="h-3.5 w-3.5" aria-hidden="true" />
								{MANUAL_ENTRY_COPY.browse}
							</button>
						</div>
						<Dropdown
							value={work}
							options={options}
							onChange={(value) => {
								setWork(value);
								flow.reset();
							}}
							disabled={busy || !projectId || workItems.isPending}
							placeholder={
								projectId && workItems.isPending
									? MANUAL_ENTRY_COPY.loadingWork
									: MANUAL_ENTRY_COPY.pickWork
							}
							ariaLabel={MANUAL_ENTRY_COPY.work}
						/>
					</div>

					{projectId ? (
						<div className="space-y-1.5">
							<span className={LABEL}>{FOR_LABEL}</span>
							<ForField
								forChoice={forChoice}
								projectId={projectId}
								layout="inline"
								mode="add"
								busy={busy}
								error={pickError}
								pickerOpen={pickerOpen}
								onPickerOpenChange={setPickerOpen}
								zIndex={zIndex + 10}
							/>
						</div>
					) : null}

					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<DateTimeField
							label={MANUAL_ENTRY_COPY.start}
							ariaLabel={MANUAL_ENTRY_COPY.start}
							value={shownStart}
							min={min}
							onChange={editStart}
							disabled={busy}
							zIndex={zIndex + 100}
						/>
						<DateTimeField
							label={MANUAL_ENTRY_COPY.end}
							ariaLabel={MANUAL_ENTRY_COPY.end}
							value={shownEnd}
							min={shownStart || min}
							onChange={editEnd}
							disabled={busy}
							zIndex={zIndex + 100}
						/>
					</div>
					{tzHint ? (
						<p className="-mt-2 text-[11px] text-muted-foreground">{tzHint}</p>
					) : null}

					<div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
						<label htmlFor={breakId} className="space-y-1.5">
							<span className={LABEL}>{MANUAL_ENTRY_COPY.break}</span>
							<input
								id={breakId}
								type="number"
								min={0}
								step={1}
								value={breakMinutes}
								onChange={(event) =>
									setBreakMinutes(
										Math.max(0, Math.round(Number(event.target.value) || 0)),
									)
								}
								disabled={busy}
								className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
							/>
						</label>
						<label htmlFor={noteId} className="space-y-1.5">
							<span className={LABEL}>{MANUAL_ENTRY_COPY.note}</span>
							<textarea
								id={noteId}
								value={note}
								maxLength={2000}
								rows={1}
								onChange={(event) => setNote(event.target.value)}
								disabled={busy}
								className="w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
							/>
						</label>
					</div>

					{validTimes && !breakTooLong ? (
						<div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
							{durationLine(grossSeconds, breakSeconds)}
						</div>
					) : null}
					{timeError ? (
						<p className="text-xs text-destructive">{timeError}</p>
					) : null}

					<EntryFormNotice flow={flow} rule={rule.message} />
				</div>
			</AppDialog>

			{browseOpen ? (
				<TaskPickerModal
					open
					mode="select"
					zIndex={zIndex + 20}
					onClose={() => setBrowseOpen(false)}
					initialProjectId={projectId}
					initialTaskId={parsed.taskId}
					initialWorkItem={parsed.workItem}
					onSelect={(selection) => {
						changeProject(selection.projectId);
						setWork(workValue(selection));
						flow.reset();
					}}
				/>
			) : null}
		</>
	);
}
