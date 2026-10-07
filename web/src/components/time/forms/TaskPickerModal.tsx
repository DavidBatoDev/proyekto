// web/src/components/time/forms/TaskPickerModal.tsx
//
// The task picker (ux.md › The Time Page › Timer › Picker order), a port of
// `team-time/TeamTimeModals` › AddLogModal onto `/api/time`:
//
//   Project → Epic → Feature → Task (search, inline create through
//   useTimeTaskCreation), or a preset under "Not on a task" (Meeting · Review
//   · Admin · Other; the workspace policy may hide some) → For.
//
// - Only projects where the person has `time.log` and at least one For option
//   are listed (A9, `useLoggableProjects`); the default is the most recently
//   logged one.
// - `mode="start"` (the Time page's Start timer): one option is a read-only
//   chip in the footer; 2+ show the radio list in the dialog body (a popover
//   would sit outside the dialog's focus trap), the remembered default
//   preselected and named on the button ("Start for Acme Corp"), and
//   the start runs through `useStartTimer`, so the Switch prompt ("Stop Fix
//   login bug (1:12) and start this?"), the locked-period Withdraw and the
//   races are W0-D's.
// - `mode="select"`: hands the project and task (or preset) back (quick add's
//   "Task or preset ▾", the full form's "Browse tasks").
//
// Unlike AddLogModal this one owns its data (projects, work items, the create
// panel), so any page can mount it with one line.

import { useQuery } from "@tanstack/react-query";
import {
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Folder,
	Layers,
	Layout,
	Loader2,
	Play,
	Plus,
	Search,
	X,
} from "lucide-react";
import {
	Fragment,
	type ReactNode,
	type RefObject,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { AppDialog } from "@/components/common/AppDialog";
import { SidePanel } from "@/components/roadmap/panels/SidePanel";
import { nativeSafe, timeErrorMessage } from "@/lib/timeErrors";
import { CHIP_LABEL_MAX, truncateLabel, workItemLabel } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import { timeQueries } from "@/queries/time";
import {
	type EntryWithWarnings,
	type MyTimeProject,
	PRESET_WORK_ITEMS,
	type PresetWorkItem,
	type ProjectTaskOption,
} from "@/services/time.types";
import type { RoadmapTask } from "@/types/roadmap";
import { ForChip } from "../for/ForChip";
import { ForPicker, ForPickerPanel } from "../for/ForPicker";
import {
	CANCEL_BUTTON,
	CANT_LOG_TITLE,
	FOR_LABEL,
	ONLY_OPTION_NOTE,
	PICKER_TITLE,
	primaryActionLabel,
	START_TIMER_LABEL,
	sameApproverNote,
	TRY_AGAIN_BUTTON,
} from "../for/forCopy";
import {
	sharedProjectLabel,
	WORKSPACE_GROUPS_COPY,
} from "../page/workspaceGroups";
import { TimeReasonCard } from "../shared/TimeReasonCard";
import { StartTimerPrompts } from "../timer/SwitchTimerDialog";
import { useStartTimer } from "../timer/useStartTimer";
import { type ForChoice, useForChoice } from "./useCreateEntry";
import {
	isArchivedProject,
	type LoggableProjects,
	projectTitle,
	useLoggableProjects,
} from "./useLoggableProjects";
import {
	type CreateTaskContext,
	type PendingEpic,
	type PendingFeature,
	useTimeTaskCreation,
} from "./useTimeTaskCreation";

// ── Copy ────────────────────────────────────────────────────────────────────

export const TASK_PICKER_COPY = {
	startTitle: "Start timer",
	startDescription:
		"Pick a project, then a task, or what you're doing if it isn't on a task.",
	selectTitle: "Choose a task",
	selectDescription: "Pick a project, then a task or a preset.",
	choose: "Choose",
	search: "Find an epic, feature or task…",
	searchLabel: "Find a task",
	project: "Project",
	epic: "Epic",
	feature: "Feature",
	task: "Task",
	notOnTask: "Not on a task",
	addEpic: "Add epic",
	addFeature: "Add feature",
	addTask: "Add task",
	newEpic: "New epic name",
	newFeature: "New feature name",
	pickProject: "Pick a project first",
	pickEpic: "Pick an epic first",
	noProjects: "No projects you can log time on yet.",
	noEpics: "No epics yet.",
	noFeatures: "No features yet.",
	noTasks: "No tasks here.",
	noTasksForSearch: "No tasks match.",
	tasksUnavailable: "Tasks on this project aren't available to you.",
	archived: "Archived",
	untitledTask: "Untitled task",
	untitledEpic: "Untitled epic",
	untitledFeature: "Untitled feature",
	pickFeatureFirst: "Select a feature before creating a task.",
	forChoose: "Choose…",
	done: "Done",
} as const;

// ── The tree (pure) ─────────────────────────────────────────────────────────

export interface TaskTreeFeature {
	featureTitle: string;
	featureId: string | null;
	tasks: ProjectTaskOption[];
}

export interface TaskTreeEpic {
	epicTitle: string;
	epicId: string | null;
	features: TaskTreeFeature[];
}

const titleOf = (raw: string | null | undefined, fallback: string) =>
	(raw ?? "").trim() || fallback;

export const taskTitle = (task: Pick<ProjectTaskOption, "title">) =>
	titleOf(task.title, TASK_PICKER_COPY.untitledTask);

/**
 * Epics and features from the flat task list (both merged by title, as the
 * picker always has), plus the epics and features created this session that
 * have no task yet. Sorted by title at every level.
 */
export function buildTaskTree(
	tasks: readonly ProjectTaskOption[],
	pendingEpics: readonly PendingEpic[] = [],
	pendingFeatures: readonly PendingFeature[] = [],
): TaskTreeEpic[] {
	const epics = new Map<
		string,
		{ epicId: string | null; features: Map<string, TaskTreeFeature> }
	>();
	const ensureEpic = (raw: string | null, id: string | null) => {
		const title = titleOf(raw, TASK_PICKER_COPY.untitledEpic);
		let entry = epics.get(title);
		if (!entry) {
			entry = { epicId: id ?? null, features: new Map() };
			epics.set(title, entry);
		} else if (!entry.epicId && id) {
			entry.epicId = id;
		}
		return entry;
	};
	const ensureFeature = (
		epic: { features: Map<string, TaskTreeFeature> },
		raw: string | null,
		id: string | null,
	) => {
		const title = titleOf(raw, TASK_PICKER_COPY.untitledFeature);
		let entry = epic.features.get(title);
		if (!entry) {
			entry = { featureTitle: title, featureId: id ?? null, tasks: [] };
			epic.features.set(title, entry);
		} else if (!entry.featureId && id) {
			entry.featureId = id;
		}
		return entry;
	};
	for (const task of tasks) {
		const epic = ensureEpic(task.epic_title, task.epic_id);
		ensureFeature(epic, task.feature_title, task.feature_id).tasks.push(task);
	}
	for (const pending of pendingEpics) ensureEpic(pending.title, pending.id);
	for (const pending of pendingFeatures) {
		ensureFeature(
			ensureEpic(pending.epicTitle, pending.epicId),
			pending.title,
			pending.id,
		);
	}
	const byTitle = (a: string, b: string) => a.localeCompare(b);
	return Array.from(epics.entries())
		.sort(([a], [b]) => byTitle(a, b))
		.map(([epicTitle, epic]) => ({
			epicTitle,
			epicId: epic.epicId,
			features: Array.from(epic.features.values())
				.sort((a, b) => byTitle(a.featureTitle, b.featureTitle))
				.map((feature) => ({
					...feature,
					tasks: [...feature.tasks].sort((a, b) =>
						byTitle(taskTitle(a), taskTitle(b)),
					),
				})),
		}));
}

/**
 * The tree cut to a search: an epic whose title matches keeps everything; a
 * feature whose title matches keeps its tasks; otherwise only matching tasks
 * (and the features and epics holding them) stay.
 */
export function filterTaskTree(
	tree: readonly TaskTreeEpic[],
	search: string,
): TaskTreeEpic[] {
	const q = search.trim().toLowerCase();
	if (!q) return [...tree];
	const hit = (text: string) => text.toLowerCase().includes(q);
	const out: TaskTreeEpic[] = [];
	for (const epic of tree) {
		if (hit(epic.epicTitle)) {
			out.push(epic);
			continue;
		}
		const features: TaskTreeFeature[] = [];
		for (const feature of epic.features) {
			if (hit(feature.featureTitle)) {
				features.push(feature);
				continue;
			}
			const tasks = feature.tasks.filter((task) => hit(taskTitle(task)));
			if (tasks.length) features.push({ ...feature, tasks });
		}
		if (features.length) out.push({ ...epic, features });
	}
	return out;
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Column({
	title,
	icon,
	action,
	children,
}: {
	title: string;
	icon: ReactNode;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			aria-label={title}
			className="flex max-h-64 min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card md:max-h-none"
		>
			<div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
				<div className="flex items-center gap-2">
					{icon}
					<span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
						{title}
					</span>
				</div>
				{action}
			</div>
			<div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5 [scrollbar-width:thin]">
				{children}
			</div>
		</section>
	);
}

function Row({
	selected,
	onClick,
	children,
	meta,
	muted = false,
}: {
	selected: boolean;
	onClick: () => void;
	children: ReactNode;
	meta?: ReactNode;
	muted?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={selected}
			className={cn(
				"group flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
				selected
					? "bg-primary/10 font-medium text-foreground"
					: muted
						? "text-muted-foreground hover:bg-muted"
						: "text-foreground hover:bg-muted",
			)}
		>
			<span className="flex min-w-0 flex-col">
				<span className="truncate">{children}</span>
				{meta ? (
					<span className="mt-0.5 text-[10px] text-muted-foreground">
						{meta}
					</span>
				) : null}
			</span>
			{selected ? (
				<CheckCircle2
					className="h-4 w-4 shrink-0 text-primary"
					aria-hidden="true"
				/>
			) : (
				<ChevronRight
					className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
					aria-hidden="true"
				/>
			)}
		</button>
	);
}

function Empty({ children }: { children: ReactNode }) {
	return (
		<p className="p-3 text-center text-xs text-muted-foreground">{children}</p>
	);
}

function Skeleton() {
	return (
		<div className="space-y-1.5 p-1" aria-hidden="true">
			<div className="h-9 w-full animate-pulse rounded-lg bg-muted" />
			<div className="h-9 w-5/6 animate-pulse rounded-lg bg-muted" />
			<div className="h-9 w-4/6 animate-pulse rounded-lg bg-muted" />
		</div>
	);
}

const SMALL_BUTTON =
	"inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50";

/** Names a new epic or feature in place (Enter confirms, Escape cancels). */
function InlineCreateRow({
	value,
	placeholder,
	busy,
	onChange,
	onSubmit,
	onCancel,
}: {
	value: string;
	placeholder: string;
	busy: boolean;
	onChange: (value: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		inputRef.current?.focus();
	}, []);
	return (
		<div className="mb-1 flex items-center gap-1.5 rounded-lg border border-input bg-background p-1.5">
			<input
				ref={inputRef}
				type="text"
				value={value}
				disabled={busy}
				placeholder={placeholder}
				aria-label={placeholder}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						onSubmit();
					} else if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						onCancel();
					}
				}}
				className="min-w-0 flex-1 bg-transparent px-1.5 py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
			/>
			<button
				type="button"
				onClick={onSubmit}
				disabled={busy || value.trim().length === 0}
				aria-label="Create"
				className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
			>
				{busy ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
				) : (
					<Check className="h-3.5 w-3.5" aria-hidden="true" />
				)}
			</button>
			<button
				type="button"
				onClick={onCancel}
				disabled={busy}
				aria-label={CANCEL_BUTTON}
				className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
			>
				<X className="h-3.5 w-3.5" aria-hidden="true" />
			</button>
		</div>
	);
}

// ── Shared by the forms ─────────────────────────────────────────────────────

const POPOVER_FOCUSABLE =
	'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

/**
 * Keyboard focus for a page-level `AnchoredPopover`. The popover is portaled
 * to <body>, so Tab from its trigger walks the whole page before reaching it:
 * once it opens, focus moves to `preferred` (or its first control); when it
 * closes with focus inside it (or lost to <body>), focus goes back to the
 * trigger. A popover inside an AppDialog can't take focus at all (the dialog
 * traps Tab in its panel), which is why the dialogs use the inline For list.
 */
export function usePopoverFocus(
	open: boolean,
	contentRef: RefObject<HTMLElement | null>,
	returnRef: RefObject<HTMLElement | null>,
	preferred?: string,
): void {
	const wasOpen = useRef(false);
	useEffect(() => {
		if (open) {
			wasOpen.current = true;
			// The popover mounts once it has measured its anchor: wait a frame.
			const frame = requestAnimationFrame(() => {
				const root = contentRef.current;
				if (!root || root.contains(document.activeElement)) return;
				const target =
					(preferred ? root.querySelector<HTMLElement>(preferred) : null) ??
					root.querySelector<HTMLElement>(POPOVER_FOCUSABLE);
				target?.focus();
			});
			return () => cancelAnimationFrame(frame);
		}
		if (!wasOpen.current) return;
		wasOpen.current = false;
		const active = document.activeElement;
		if (active && active !== document.body) return;
		const back = returnRef.current;
		const target = back?.matches(POPOVER_FOCUSABLE)
			? back
			: back?.querySelector<HTMLElement>(POPOVER_FOCUSABLE);
		target?.focus();
	}, [open, contentRef, returnRef, preferred]);
}

/**
 * A failed A9 read (`me/projects`): a reason card with Try again, never the
 * "nothing to log on" empty state (ux.md › Chrome: a refusal never looks like
 * an empty page).
 */
export function LoggableProjectsError({
	projects,
	className,
}: {
	projects: Pick<LoggableProjects, "error" | "query">;
	className?: string;
}) {
	return (
		<TimeReasonCard
			variant="inline"
			tone="danger"
			role="alert"
			title={timeErrorMessage(projects.error, { operation: "read" })}
			className={className}
			action={
				<button
					type="button"
					onClick={() => void projects.query.refetch()}
					className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
				>
					{TRY_AGAIN_BUTTON}
				</button>
			}
		/>
	);
}

/** The project list failed and there is nothing cached to fall back on. */
export function loggableProjectsFailed(
	projects: Pick<LoggableProjects, "isError" | "projects">,
): boolean {
	return projects.isError && projects.projects.length === 0;
}

// ── The For step (shared by the forms) ─────────────────────────────────────────

export interface ForFieldProps {
	forChoice: ForChoice;
	projectId: string | null;
	/**
	 * `chip` (default): a chip, with the picker in a popover (quick add, the
	 * task picker's footer). `inline`: the radio list in place (the full form).
	 */
	layout?: "chip" | "inline";
	/** `start` → "Start for …"; `add` → "Add for …". */
	mode: "start" | "add";
	/**
	 * Chip layout: the popover's primary button ("Add for Acme Corp") does the
	 * write, so one tap confirms. Without it the popover only picks.
	 */
	onConfirm?: () => void;
	busy?: boolean;
	disabled?: boolean;
	/** An inline message in the popover (LOGGING_FOR_REQUIRED / _INVALID). */
	error?: string | null;
	/** The picker popover, controlled by the caller (opened from the primary button). */
	pickerOpen: boolean;
	onPickerOpenChange: (open: boolean) => void;
	projectWorkspaceName?: string | null;
	/** Above the dialog the field sits in. */
	zIndex?: number;
	className?: string;
}

/** The For control of the forms (ux.md › For Chip). */
export function ForField({
	forChoice,
	projectId,
	layout = "chip",
	mode,
	onConfirm,
	busy = false,
	disabled = false,
	error,
	pickerOpen,
	onPickerOpenChange,
	projectWorkspaceName,
	zIndex,
	className,
}: ForFieldProps) {
	const anchorRef = useRef<HTMLSpanElement | null>(null);
	const popoverRef = useRef<HTMLDivElement | null>(null);
	usePopoverFocus(
		layout === "chip" && pickerOpen,
		popoverRef,
		anchorRef,
		'input[type="radio"]:checked:not([disabled])',
	);
	const loggable = useLoggableProjects();
	if (!projectId) return null;
	const { result, option, mode: forMode } = forChoice;
	// An outside project whose only option is "Just me": say why, quietly.
	const sharedProject = loggable.sharedIds.has(projectId)
		? (loggable.byId.get(projectId) ?? null)
		: null;
	const sharedHint =
		sharedProject &&
		result &&
		result.options.length > 0 &&
		result.options.every((item) => item.kind === "personal") ? (
			<p
				className="text-xs text-muted-foreground"
				data-testid="for-shared-hint"
			>
				{nativeSafe(
					WORKSPACE_GROUPS_COPY.sharedJustMe(sharedProject.workspace_name),
				)}
			</p>
		) : null;

	if (forChoice.isLoading || (!result && !forChoice.error)) {
		return (
			<span
				className={cn(
					"inline-flex items-center gap-1 text-xs text-muted-foreground",
					className,
				)}
				aria-busy="true"
			>
				{FOR_LABEL}:
				<span className="h-5 w-24 animate-pulse rounded-md bg-muted" />
			</span>
		);
	}
	if (!result || forMode === "none") {
		return (
			<span className={cn("text-xs text-muted-foreground", className)}>
				{CANT_LOG_TITLE}
			</span>
		);
	}
	if (forMode === "single" && option) {
		const chipEl = (
			<ForChip
				option={option}
				variant="readonly"
				// One option, or several that share an approver and rate (the
				// resolver's `selected`): ux.md › For Chip words them apart.
				note={result.options.length > 1 ? sameApproverNote() : ONLY_OPTION_NOTE}
				projectId={projectId}
				projectWorkspaceName={projectWorkspaceName}
				personalReason={result.personal_reason ?? null}
				showPrefix
				popoverZIndex={zIndex}
				className={className}
			/>
		);
		return sharedHint ? (
			<span className="inline-flex flex-col gap-1">
				{chipEl}
				{sharedHint}
			</span>
		) : (
			chipEl
		);
	}

	if (layout === "inline") {
		return (
			<div className={cn("space-y-1.5", className)}>
				{error ? (
					<p
						role="alert"
						className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground"
					>
						{error}
					</p>
				) : null}
				<ForPicker
					result={result}
					value={forChoice.choice}
					onChange={(picked) => forChoice.select(picked)}
					remember={forChoice.remember}
					onRememberChange={forChoice.setRemember}
					disabled={disabled || busy}
					projectWorkspaceName={projectWorkspaceName}
				/>
			</div>
		);
	}

	const toggle = () => {
		if (!disabled) onPickerOpenChange(!pickerOpen);
	};
	return (
		<>
			<span ref={anchorRef} className={cn("inline-flex min-w-0", className)}>
				{option ? (
					<ForChip
						option={option}
						variant="menu"
						onOpenMenu={toggle}
						menuOpen={pickerOpen}
						showPrefix
					/>
				) : (
					<span className="inline-flex items-center gap-1">
						<span className="text-xs text-muted-foreground">{FOR_LABEL}:</span>
						<button
							type="button"
							onClick={toggle}
							disabled={disabled}
							aria-haspopup="dialog"
							aria-expanded={pickerOpen}
							className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
						>
							{TASK_PICKER_COPY.forChoose}
							<ChevronDown className="h-3 w-3" aria-hidden="true" />
						</button>
					</span>
				)}
			</span>
			<AnchoredPopover
				anchorRef={anchorRef}
				open={pickerOpen}
				onClose={() => {
					if (!busy) onPickerOpenChange(false);
				}}
				width={320}
				maxHeight={440}
				zIndex={zIndex}
				ariaLabel={PICKER_TITLE}
			>
				<div ref={popoverRef}>
					{onConfirm ? (
						<ForPickerPanel
							mode={mode}
							result={result}
							value={forChoice.choice}
							onChange={(picked) => forChoice.select(picked)}
							remember={forChoice.remember}
							onRememberChange={forChoice.setRemember}
							busy={busy}
							error={error}
							projectWorkspaceName={projectWorkspaceName}
							onConfirm={onConfirm}
							onCancel={() => onPickerOpenChange(false)}
						/>
					) : (
						<div className="space-y-3 p-3">
							<p className="text-sm font-semibold text-foreground">
								{PICKER_TITLE}
							</p>
							{error ? (
								<p
									role="alert"
									className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground"
								>
									{error}
								</p>
							) : null}
							<ForPicker
								result={result}
								value={forChoice.choice}
								onChange={(picked) => forChoice.select(picked)}
								remember={forChoice.remember}
								onRememberChange={forChoice.setRemember}
								disabled={disabled || busy}
								projectWorkspaceName={projectWorkspaceName}
							/>
							<div className="flex justify-end">
								<button
									type="button"
									onClick={() => onPickerOpenChange(false)}
									className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
								>
									{TASK_PICKER_COPY.done}
								</button>
							</div>
						</div>
					)}
				</div>
			</AnchoredPopover>
		</>
	);
}

/** The primary button's text: "Add for Acme Corp" when 2+ options and one is chosen. */
export function forActionLabel(
	forChoice: Pick<ForChoice, "mode" | "option">,
	mode: "start" | "add",
	fallback: string,
): string {
	if (
		(forChoice.mode === "choose" || forChoice.mode === "confirm") &&
		forChoice.option
	) {
		return primaryActionLabel(
			mode,
			truncateLabel(forChoice.option.label, CHIP_LABEL_MAX),
		);
	}
	return fallback;
}

const NO_TASKS: ProjectTaskOption[] = [];

// ── The modal ───────────────────────────────────────────────────────────────

export interface TaskPickerSelection {
	projectId: string;
	projectTitle: string;
	/** XOR `workItem`. */
	taskId: string | null;
	taskTitle: string | null;
	workItem: PresetWorkItem | null;
}

export interface TaskPickerModalProps {
	open: boolean;
	onClose: () => void;
	/**
	 * `start` (default): the For step, then the timer starts. `select`: the
	 * choice is handed to `onSelect` and the modal closes.
	 */
	mode?: "start" | "select";
	initialProjectId?: string | null;
	initialTaskId?: string | null;
	initialWorkItem?: PresetWorkItem | null;
	/** Only `initialProjectId` is offered (changing an entry's task). */
	lockProject?: boolean;
	/** The locked project's title when it isn't in the loggable list. */
	lockedProjectTitle?: string | null;
	title?: string;
	description?: string;
	/** `select` mode's button (default "Choose"). */
	confirmLabel?: string;
	onSelect?: (selection: TaskPickerSelection) => void;
	/** `start` mode: after the server started the timer (the modal closes itself). */
	onStarted?: (entry: EntryWithWarnings) => void;
	zIndex?: number;
}

export function TaskPickerModal(props: TaskPickerModalProps) {
	// Mounted only while open, so every opening starts from its props.
	if (!props.open) return null;
	return <TaskPicker {...props} />;
}

function TaskPicker({
	onClose,
	mode = "start",
	initialProjectId = null,
	initialTaskId = null,
	initialWorkItem = null,
	lockProject = false,
	lockedProjectTitle = null,
	title,
	description,
	confirmLabel,
	onSelect,
	onStarted,
	zIndex = 1200,
}: TaskPickerModalProps) {
	const projects = useLoggableProjects({
		preferredProjectId: initialProjectId,
	});
	const [projectId, setProjectId] = useState<string | null>(initialProjectId);
	const [taskId, setTaskId] = useState<string | null>(initialTaskId);
	const [workItem, setWorkItem] = useState<PresetWorkItem | null>(
		initialTaskId ? null : initialWorkItem,
	);
	const [epicTitle, setEpicTitle] = useState<string | null>(null);
	const [featureTitle, setFeatureTitle] = useState<string | null>(null);
	const [searchText, setSearchText] = useState("");
	const [search, setSearch] = useState("");
	const [epicDraft, setEpicDraft] = useState<string | null>(null);
	const [featureDraft, setFeatureDraft] = useState<string | null>(null);
	const [createTask, setCreateTask] = useState<CreateTaskContext | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);
	const forSectionRef = useRef<HTMLElement | null>(null);

	// The default project once the list is in (the most recently logged), also
	// when the one passed in is not loggable.
	const loaded = projects.query.isSuccess;
	const loggable = projectId ? projects.byId.has(projectId) : false;
	useEffect(() => {
		if (lockProject) return;
		if (projectId && (loggable || !loaded)) return;
		if (projects.defaultProjectId && projects.defaultProjectId !== projectId) {
			if (projectId) {
				setTaskId(null);
				setWorkItem(null);
			}
			setProjectId(projects.defaultProjectId);
		}
	}, [projectId, lockProject, loaded, loggable, projects.defaultProjectId]);

	useEffect(() => {
		const timeout = window.setTimeout(() => setSearch(searchText), 200);
		return () => window.clearTimeout(timeout);
	}, [searchText]);

	const workItems = useQuery(timeQueries.workItems(projectId));
	const tasks = workItems.data?.tasks ?? NO_TASKS;
	const presets: readonly PresetWorkItem[] =
		workItems.data?.presets ?? (workItems.isError ? PRESET_WORK_ITEMS : []);

	const creation = useTimeTaskCreation({
		projectId,
		tasks,
		onTaskCreated: (id) => {
			setTaskId(id);
			setWorkItem(null);
			setEpicTitle(null);
			setFeatureTitle(null);
		},
		onTaskSettled: () => setCreateTask(null),
	});

	const tree = useMemo(
		() => buildTaskTree(tasks, creation.pendingEpics, creation.pendingFeatures),
		[tasks, creation.pendingEpics, creation.pendingFeatures],
	);
	const visible = useMemo(() => filterTaskTree(tree, search), [tree, search]);

	// The selected task's place in the tree, so a preselected task opens on it.
	const taskPlace = useMemo(() => {
		if (!taskId) return null;
		for (const epic of tree) {
			for (const feature of epic.features) {
				if (feature.tasks.some((task) => task.id === taskId)) {
					return { epic: epic.epicTitle, feature: feature.featureTitle };
				}
			}
		}
		return null;
	}, [tree, taskId]);

	const activeEpic =
		visible.find((epic) => epic.epicTitle === (epicTitle ?? taskPlace?.epic)) ??
		visible[0] ??
		null;
	const activeFeature =
		activeEpic?.features.find(
			(feature) =>
				feature.featureTitle === (featureTitle ?? taskPlace?.feature),
		) ??
		activeEpic?.features[0] ??
		null;
	const selectedTask = tasks.find((task) => task.id === taskId) ?? null;

	const forChoice = useForChoice(projectId, { enabled: mode === "start" });
	const flow = useStartTimer({
		onStarted: (entry) => {
			onStarted?.(entry);
			onClose();
		},
	});

	const listed = lockProject
		? projects.projects.filter((p) => p.id === initialProjectId)
		: projects.projects;
	const projectRows: Array<
		Pick<MyTimeProject, "id" | "title" | "status" | "workspace_name">
	> =
		lockProject && initialProjectId && listed.length === 0
			? [
					{
						id: initialProjectId,
						title: lockedProjectTitle ?? "",
						status: null,
					},
				]
			: listed;
	const currentProject =
		projectRows.find((project) => project.id === projectId) ?? null;

	const changeProject = (id: string) => {
		if (id === projectId) return;
		setProjectId(id);
		setTaskId(null);
		setWorkItem(null);
		setEpicTitle(null);
		setFeatureTitle(null);
		setEpicDraft(null);
		setFeatureDraft(null);
		setPickerOpen(false);
		creation.reset();
	};

	// 2+ options: the radio list sits in the dialog body, never in a popover.
	// A popover is portaled outside the dialog panel, so the dialog's Tab trap
	// (and `aria-modal`) would keep keyboard and screen-reader users out of it.
	const inlineFor =
		mode === "start" &&
		Boolean(projectId) &&
		(forChoice.mode === "choose" || forChoice.mode === "confirm");
	const projectsFailed = !lockProject && loggableProjectsFailed(projects);

	const hasWork = Boolean(taskId || workItem);
	const busy = flow.isPending;

	// Once the work is picked, the For list is the next step. It sits under the
	// four columns (below the fold at 1280×800, or on a phone), so bring it
	// into view instead of leaving a second option and the Remember box unseen.
	const forIsNext = inlineFor && hasWork;
	useEffect(() => {
		if (!forIsNext) return;
		forSectionRef.current?.scrollIntoView?.({ block: "nearest" });
	}, [forIsNext]);
	const canConfirm =
		Boolean(projectId) &&
		hasWork &&
		!busy &&
		(mode === "select" || (!forChoice.isLoading && forChoice.mode !== "none"));

	const confirm = () => {
		if (!canConfirm || !projectId) return;
		if (mode === "select") {
			onSelect?.({
				projectId,
				projectTitle: projectTitle(currentProject),
				taskId,
				taskTitle: selectedTask ? taskTitle(selectedTask) : null,
				workItem: taskId ? null : workItem,
			});
			onClose();
			return;
		}
		if (forChoice.needsChoice) {
			// Nothing chosen yet: take the person to the For list.
			const first = forSectionRef.current?.querySelector<HTMLInputElement>(
				'input[type="radio"]:not([disabled])',
			);
			first?.focus();
			first?.scrollIntoView?.({ block: "nearest" });
			return;
		}
		setPickerOpen(false);
		// The only option is not sent: the start flow resolves it fresh.
		const explicit =
			!forChoice.autoChoice && forChoice.choice && forChoice.option
				? {
						loggingFor: forChoice.choice,
						loggingForLabel: forChoice.option.label,
						remember: forChoice.remember,
					}
				: {};
		void flow
			.start({
				projectId,
				...(taskId ? { taskId } : workItem ? { workItem } : {}),
				...explicit,
			})
			.then((outcome) => {
				// That very timer is already running: nothing to start.
				if (outcome === "already_running") onClose();
			});
	};

	const submitEpicDraft = async () => {
		const value = (epicDraft ?? "").trim();
		if (!value) {
			setEpicDraft(null);
			return;
		}
		const created = await creation.createEpic(value);
		if (!created) return; // toasted; keep the row open to retry
		setEpicDraft(null);
		setEpicTitle(titleOf(created.title, TASK_PICKER_COPY.untitledEpic));
		setFeatureTitle(null);
		setTaskId(null);
	};

	const submitFeatureDraft = async () => {
		const value = (featureDraft ?? "").trim();
		const epic = activeEpic?.epicTitle ?? null;
		if (!value || !epic) {
			setFeatureDraft(null);
			return;
		}
		const created = await creation.createFeature({
			epicId: activeEpic?.epicId ?? null,
			epicTitle: epic,
			title: value,
		});
		if (!created) return;
		setFeatureDraft(null);
		setEpicTitle(epic);
		setFeatureTitle(titleOf(created.title, TASK_PICKER_COPY.untitledFeature));
		setTaskId(null);
	};

	const openCreateTask = () => {
		const featureId =
			activeFeature?.featureId ?? activeFeature?.tasks[0]?.feature_id ?? null;
		setCreateTask({
			featureId,
			epicTitle: activeEpic?.epicTitle ?? null,
			featureTitle: activeFeature?.featureTitle ?? null,
		});
	};

	const loadingTasks = Boolean(projectId) && workItems.isPending;
	const primaryLabel =
		mode === "select"
			? (confirmLabel ?? TASK_PICKER_COPY.choose)
			: forActionLabel(forChoice, "start", START_TIMER_LABEL);

	const footer = (
		<div className="flex w-full flex-wrap items-center gap-2">
			{mode === "start" && projectId && !inlineFor ? (
				<ForField
					forChoice={forChoice}
					projectId={projectId}
					mode="start"
					onConfirm={confirm}
					busy={busy}
					pickerOpen={pickerOpen}
					onPickerOpenChange={setPickerOpen}
					zIndex={zIndex + 10}
					className="mr-auto"
				/>
			) : (
				<span className="mr-auto" />
			)}
			<button
				type="button"
				onClick={onClose}
				disabled={busy}
				className="rounded-lg border border-border px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
			>
				{CANCEL_BUTTON}
			</button>
			<button
				type="button"
				onClick={confirm}
				disabled={!canConfirm}
				className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{busy ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
				) : mode === "start" ? (
					<Play className="h-3.5 w-3.5" aria-hidden="true" />
				) : null}
				{primaryLabel}
			</button>
		</div>
	);

	return (
		<>
			<AppDialog
				open
				onClose={onClose}
				// The create panel sits on top: Escape and the backdrop wait for it.
				busy={busy || createTask !== null}
				size="xl"
				zIndex={zIndex}
				className="lg:max-w-6xl"
				title={
					title ??
					(mode === "start"
						? TASK_PICKER_COPY.startTitle
						: TASK_PICKER_COPY.selectTitle)
				}
				description={
					description ??
					(mode === "start"
						? TASK_PICKER_COPY.startDescription
						: TASK_PICKER_COPY.selectDescription)
				}
				footer={footer}
			>
				<div className="space-y-3">
					<div className="relative">
						<Search
							className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<input
							type="search"
							value={searchText}
							onChange={(event) => setSearchText(event.target.value)}
							placeholder={TASK_PICKER_COPY.search}
							aria-label={TASK_PICKER_COPY.searchLabel}
							className="w-full rounded-lg border border-input bg-background py-2 pr-3 pl-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25"
						/>
					</div>

					<div className="grid grid-cols-1 gap-3 md:h-[52vh] md:min-h-[360px] md:grid-cols-4">
						<Column
							title={TASK_PICKER_COPY.project}
							icon={
								<Folder
									className="h-4 w-4 text-muted-foreground"
									aria-hidden="true"
								/>
							}
						>
							{projects.isLoading && !lockProject ? (
								<Skeleton />
							) : projectsFailed ? (
								<LoggableProjectsError projects={projects} className="m-1" />
							) : projectRows.length === 0 ? (
								<Empty>{TASK_PICKER_COPY.noProjects}</Empty>
							) : (
								projectRows.map((project, index) => {
									const shared = projects.sharedIds.has(project.id);
									const firstShared =
										shared &&
										!projects.sharedIds.has(projectRows[index - 1]?.id ?? "");
									return (
										<Fragment key={project.id}>
											{firstShared ? (
												<p
													className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
													data-testid="picker-shared-heading"
												>
													{WORKSPACE_GROUPS_COPY.shared}
												</p>
											) : null}
											<Row
												selected={project.id === projectId}
												onClick={() => changeProject(project.id)}
												muted={isArchivedProject(project)}
												meta={
													isArchivedProject(project)
														? TASK_PICKER_COPY.archived
														: undefined
												}
											>
												{shared
													? sharedProjectLabel(
															projectTitle(project),
															project.workspace_name,
														)
													: projectTitle(project)}
											</Row>
										</Fragment>
									);
								})
							)}
						</Column>

						<Column
							title={TASK_PICKER_COPY.epic}
							icon={
								<Layers
									className="h-4 w-4 text-muted-foreground"
									aria-hidden="true"
								/>
							}
							action={
								<button
									type="button"
									onClick={() => setEpicDraft("")}
									disabled={
										!projectId ||
										loadingTasks ||
										workItems.isError ||
										creation.creatingEpic ||
										epicDraft !== null
									}
									className={SMALL_BUTTON}
								>
									<Plus className="h-3 w-3" aria-hidden="true" />
									{TASK_PICKER_COPY.addEpic}
								</button>
							}
						>
							{epicDraft !== null ? (
								<InlineCreateRow
									value={epicDraft}
									placeholder={TASK_PICKER_COPY.newEpic}
									busy={creation.creatingEpic}
									onChange={setEpicDraft}
									onSubmit={() => void submitEpicDraft()}
									onCancel={() => setEpicDraft(null)}
								/>
							) : null}
							{!projectId ? (
								<Empty>{TASK_PICKER_COPY.pickProject}</Empty>
							) : loadingTasks ? (
								<Skeleton />
							) : workItems.isError ? (
								<Empty>{TASK_PICKER_COPY.tasksUnavailable}</Empty>
							) : visible.length === 0 ? (
								<Empty>
									{search
										? TASK_PICKER_COPY.noTasksForSearch
										: TASK_PICKER_COPY.noEpics}
								</Empty>
							) : (
								visible.map((epic) => (
									<Row
										key={epic.epicTitle}
										selected={epic.epicTitle === activeEpic?.epicTitle}
										onClick={() => {
											setEpicTitle(epic.epicTitle);
											setFeatureTitle(null);
										}}
										meta={
											epic.epicTitle === activeEpic?.epicTitle
												? undefined
												: `${epic.features.length} feature${epic.features.length === 1 ? "" : "s"}`
										}
									>
										{epic.epicTitle}
									</Row>
								))
							)}
						</Column>

						<Column
							title={TASK_PICKER_COPY.feature}
							icon={
								<Layout
									className="h-4 w-4 text-muted-foreground"
									aria-hidden="true"
								/>
							}
							action={
								<button
									type="button"
									onClick={() => setFeatureDraft("")}
									disabled={
										!projectId ||
										loadingTasks ||
										workItems.isError ||
										creation.creatingFeature ||
										featureDraft !== null ||
										!activeEpic
									}
									className={SMALL_BUTTON}
								>
									<Plus className="h-3 w-3" aria-hidden="true" />
									{TASK_PICKER_COPY.addFeature}
								</button>
							}
						>
							{featureDraft !== null ? (
								<InlineCreateRow
									value={featureDraft}
									placeholder={TASK_PICKER_COPY.newFeature}
									busy={creation.creatingFeature}
									onChange={setFeatureDraft}
									onSubmit={() => void submitFeatureDraft()}
									onCancel={() => setFeatureDraft(null)}
								/>
							) : null}
							{!projectId ? (
								<Empty>{TASK_PICKER_COPY.pickProject}</Empty>
							) : loadingTasks ? (
								<Skeleton />
							) : !activeEpic ? (
								<Empty>
									{workItems.isError
										? TASK_PICKER_COPY.tasksUnavailable
										: TASK_PICKER_COPY.pickEpic}
								</Empty>
							) : activeEpic.features.length === 0 ? (
								<Empty>{TASK_PICKER_COPY.noFeatures}</Empty>
							) : (
								activeEpic.features.map((feature) => (
									<Row
										key={feature.featureTitle}
										selected={
											feature.featureTitle === activeFeature?.featureTitle
										}
										onClick={() => {
											setEpicTitle(activeEpic.epicTitle);
											setFeatureTitle(feature.featureTitle);
										}}
										meta={
											feature.featureTitle === activeFeature?.featureTitle
												? undefined
												: `${feature.tasks.length} task${feature.tasks.length === 1 ? "" : "s"}`
										}
									>
										{feature.featureTitle}
									</Row>
								))
							)}
						</Column>

						<Column
							title={TASK_PICKER_COPY.task}
							icon={
								<CheckCircle2
									className="h-4 w-4 text-muted-foreground"
									aria-hidden="true"
								/>
							}
							action={
								<button
									type="button"
									onClick={openCreateTask}
									disabled={
										!projectId ||
										loadingTasks ||
										workItems.isError ||
										creation.creatingTask ||
										!activeFeature
									}
									className={SMALL_BUTTON}
								>
									<Plus className="h-3 w-3" aria-hidden="true" />
									{TASK_PICKER_COPY.addTask}
								</button>
							}
						>
							{!projectId ? (
								<Empty>{TASK_PICKER_COPY.pickProject}</Empty>
							) : loadingTasks ? (
								<Skeleton />
							) : (
								<>
									{presets.length ? (
										<div className="mb-1 space-y-1">
											<p className="px-2.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
												{TASK_PICKER_COPY.notOnTask}
											</p>
											{presets.map((preset) => (
												<Row
													key={preset}
													selected={!taskId && workItem === preset}
													onClick={() => {
														setWorkItem(preset);
														setTaskId(null);
													}}
												>
													<span
														aria-hidden="true"
														className="mr-1.5 text-muted-foreground"
													>
														◦
													</span>
													{workItemLabel(preset)}
												</Row>
											))}
											<div className="my-1.5 h-px w-full bg-border" />
										</div>
									) : null}
									{workItems.isError ? (
										<Empty>{TASK_PICKER_COPY.tasksUnavailable}</Empty>
									) : !activeFeature || activeFeature.tasks.length === 0 ? (
										<Empty>
											{search
												? TASK_PICKER_COPY.noTasksForSearch
												: TASK_PICKER_COPY.noTasks}
										</Empty>
									) : (
										activeFeature.tasks.map((task) => (
											<Row
												key={task.id}
												selected={task.id === taskId}
												onClick={() => {
													setTaskId(task.id);
													setWorkItem(null);
												}}
											>
												{taskTitle(task)}
											</Row>
										))
									)}
								</>
							)}
						</Column>
					</div>

					{inlineFor && projectId ? (
						<section
							ref={forSectionRef}
							aria-label={FOR_LABEL}
							className="space-y-1.5 rounded-xl border border-border bg-card p-3"
						>
							<p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
								{FOR_LABEL}
							</p>
							<ForField
								forChoice={forChoice}
								projectId={projectId}
								layout="inline"
								mode="start"
								busy={busy}
								pickerOpen={false}
								onPickerOpenChange={setPickerOpen}
								zIndex={zIndex + 10}
							/>
						</section>
					) : null}
				</div>
			</AppDialog>

			{createTask ? (
				<SidePanel
					task={null}
					isOpen
					isCreating
					projectId={projectId ?? undefined}
					onClose={() => {
						if (!creation.creatingTask) setCreateTask(null);
					}}
					onUpdateTask={() => {}}
					onDeleteTask={() => {}}
					onCreateTask={(taskData: Partial<RoadmapTask>) => {
						void creation.createTask({
							taskData,
							featureId: createTask.featureId,
							context: createTask,
						});
					}}
					isLoading={creation.creatingTask}
					zIndexBase={10000}
				/>
			) : null}

			{mode === "start" ? (
				<StartTimerPrompts flow={flow} zIndex={zIndex + 20} />
			) : null}
		</>
	);
}
