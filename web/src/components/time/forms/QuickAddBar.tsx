// web/src/components/time/forms/QuickAddBar.tsx
//
// Quick add (ux.md › The Time Page › Quick add):
//
//   [ Task or preset ▾ ] [ 1:30 ] [ Yesterday ▾ ] [For: Prodigitality S… ▾] [Add]   More options →
//
// - The duration accepts `1:30`, `90m` or `1.5h`. The start defaults to the
//   end of that day's last entry, or 09:00 in the context's timezone.
// - "More options" opens the full form (ManualEntryModal) for exact in and out
//   times and breaks, seeded with what the bar holds.
// - A disabled control gives its reason inline: "Manual time is off in your
//   agreement with Acme." (MANUAL_ENTRIES_DISABLED) or "Prodigitality accepts
//   time up to 7 days back." (RETROACTIVE_WINDOW).
//
// The For control (`ForField`, exported for the other forms) follows the For
// chip rules: one option is a read-only chip ("Only option on this project");
// 2+ options open the picker, where a remembered default is preselected and
// named on the button ("Add for Acme Corp"), never applied silently (L38).

import { CalendarDays, ChevronDown, ListChecks, Loader2 } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { nativeSafe, retroactiveWindowCopy } from "@/lib/timeErrors";
import {
	deviceTimeZone,
	formatInstantTime,
	formatLocalDay,
	parseDurationInput,
} from "@/lib/timeFormat";
import { addDays, retroactiveFloor, todayIn } from "@/lib/timePeriods";
import { cn } from "@/lib/utils";
import type { EntryWithWarnings } from "@/services/time.types";
import {
	EntryFormNotice,
	type ManualEntryDraft,
	ManualEntryModal,
} from "./ManualEntryModal";
import {
	ForField,
	forActionLabel,
	LoggableProjectsError,
	loggableProjectsFailed,
	presetLabel,
	TaskPickerModal,
	type TaskPickerSelection,
	usePopoverFocus,
} from "./TaskPickerModal";
import {
	forRequestFields,
	manualEntryRule,
	useCreateEntry,
	useDefaultStart,
	useEntryContext,
} from "./useCreateEntry";
import { projectTitle, useLoggableProjects } from "./useLoggableProjects";

// ── Copy (ux.md where it gives one) ─────────────────────────────────────────

export const QUICK_ADD_COPY = {
	work: "Task or preset",
	add: "Add",
	moreOptions: "More options →",
	duration: "Duration",
	durationPlaceholder: "1:30",
	durationHint: "Use 1:30, 90m or 1.5h.",
	day: "Day",
	today: "Today",
	yesterday: "Yesterday",
	label: "Quick add",
} as const;

/** Days the bar offers: today and the six before it. */
export const QUICK_ADD_DAYS = 7;

export interface QuickAddDay {
	/** `YYYY-MM-DD` in the context's timezone. */
	day: string;
	/** Days before today (0 = today). */
	offset: number;
	label: string;
	/** Older than the context accepts (RETROACTIVE_WINDOW). */
	disabled: boolean;
}

/** "Today", "Yesterday", then "Sun Oct 4"…, older days greyed past the floor. */
export function quickAddDays(input: {
	timezone: string;
	now?: Date;
	count?: number;
	/** The oldest local date accepted (null = no limit). */
	floor?: string | null;
}): QuickAddDay[] {
	const today = todayIn(input.timezone, input.now ?? new Date());
	const count = Math.max(1, input.count ?? QUICK_ADD_DAYS);
	const out: QuickAddDay[] = [];
	for (let offset = 0; offset < count; offset += 1) {
		const day = addDays(today, -offset);
		out.push({
			day,
			offset,
			label:
				offset === 0
					? QUICK_ADD_COPY.today
					: offset === 1
						? QUICK_ADD_COPY.yesterday
						: formatLocalDay(day, {
								weekday: true,
								now: input.now,
								userTimezone: input.timezone,
							}),
			disabled: Boolean(input.floor && day < input.floor),
		});
	}
	return out;
}

/** "09:00–10:30" in `tz`, plus " (Asia/Manila)" when it isn't the device's. */
export function intervalPreview(
	start: Date,
	end: Date,
	tz: string,
	deviceTz: string = deviceTimeZone(),
): string {
	const span = `${formatInstantTime(start.toISOString(), tz)}–${formatInstantTime(
		end.toISOString(),
		tz,
	)}`;
	return tz === deviceTz ? span : `${span} (${tz})`;
}

/** The work button's text: the task, "◦ Meeting", or the placeholder. */
export function workLabel(
	selection: Pick<TaskPickerSelection, "taskTitle" | "workItem"> | null,
): string {
	if (!selection) return QUICK_ADD_COPY.work;
	if (selection.taskTitle?.trim()) return selection.taskTitle.trim();
	if (selection.workItem) return `◦ ${presetLabel(selection.workItem)}`;
	return QUICK_ADD_COPY.work;
}

// ── The bar ─────────────────────────────────────────────────────────────────

export interface QuickAddBarProps {
	/** Default project (`?project=` on /time); else the most recently logged one. */
	projectId?: string | null;
	/** Default day (`YYYY-MM-DD`); else today in the context's timezone. */
	day?: string | null;
	onAdded?: (entry: EntryWithWarnings) => void;
	/** Stacking for the bar's popovers and dialogs (default: page level). */
	zIndex?: number;
	className?: string;
}

export function QuickAddBar({
	projectId: preferredProjectId,
	day: initialDay,
	onAdded,
	zIndex,
	className,
}: QuickAddBarProps) {
	const durationId = useId();
	const projects = useLoggableProjects({ preferredProjectId });
	const [selection, setSelection] = useState<TaskPickerSelection | null>(null);
	const projectId = selection?.projectId ?? projects.defaultProjectId;
	const project = projectId ? (projects.byId.get(projectId) ?? null) : null;

	const ctx = useEntryContext(projectId);
	const { forChoice, policy, timezone } = ctx;

	const [durationText, setDurationText] = useState("");
	const duration = parseDurationInput(durationText);
	const durationInvalid = durationText.trim() !== "" && duration === null;

	// The day: the caller's, until the person picks one (kept as "days before
	// today", so it follows the context's timezone).
	const [dayOffset, setDayOffset] = useState<number | null>(null);
	const today = todayIn(timezone);
	const day =
		dayOffset !== null
			? addDays(today, -dayOffset)
			: initialDay && /^\d{4}-\d{2}-\d{2}$/.test(initialDay)
				? initialDay
				: today;

	const floor = retroactiveFloor(
		new Date(),
		timezone,
		forChoice.option?.kind === "personal"
			? null
			: (policy?.retroactive_days ?? null),
	);
	const days = useMemo(
		() => quickAddDays({ timezone, floor }),
		[timezone, floor],
	);
	// Why older days are greyed in the day menu (RETROACTIVE_WINDOW).
	const windowNote =
		floor && forChoice.option && forChoice.option.kind !== "personal"
			? nativeSafe(
					retroactiveWindowCopy({
						label: forChoice.option.label,
						labelKind: forChoice.option.kind,
						days: policy?.retroactive_days,
					}),
				)
			: null;
	const rule = manualEntryRule({
		policy,
		option: forChoice.option,
		day,
		timezone,
	});

	const { start } = useDefaultStart({
		day,
		timezone,
		enabled: Boolean(projectId),
	});
	const end =
		start && duration ? new Date(start.getTime() + duration * 1000) : null;

	const [pickerOpen, setPickerOpen] = useState(false);
	const [workOpen, setWorkOpen] = useState(false);
	const [dayOpen, setDayOpen] = useState(false);
	const [moreOpen, setMoreOpen] = useState<ManualEntryDraft | null>(null);
	const dayRef = useRef<HTMLButtonElement | null>(null);
	const dayListRef = useRef<HTMLDivElement | null>(null);
	// The day menu is portaled to <body>: take keyboard focus there and back.
	usePopoverFocus(
		dayOpen,
		dayListRef,
		dayRef,
		'[role="option"][aria-selected="true"]:not([disabled])',
	);

	const flow = useCreateEntry({
		onCreated: (entry) => {
			setDurationText("");
			setPickerOpen(false);
			onAdded?.(entry);
		},
	});

	const hasWork = Boolean(selection?.taskId || selection?.workItem);
	const ready =
		Boolean(projectId) &&
		hasWork &&
		duration !== null &&
		Boolean(start && end) &&
		!rule.blocked &&
		!forChoice.isLoading &&
		// The context's timezone and rules arrive with its policy.
		!ctx.policyLoading &&
		forChoice.mode !== "none" &&
		!flow.isPending;

	const submit = async () => {
		if (!ready || !projectId || !start || !end) return;
		if (forChoice.needsChoice) {
			setPickerOpen(true);
			return;
		}
		const outcome = await flow.create({
			projectId,
			taskId: selection?.taskId ?? null,
			workItem: selection?.workItem ?? null,
			startedAt: start.toISOString(),
			endedAt: end.toISOString(),
			...forRequestFields(forChoice),
			retroactiveDays: policy?.retroactive_days ?? null,
		});
		if (outcome === "pick") setPickerOpen(true);
	};

	const openMore = () => {
		flow.reset();
		setMoreOpen({
			projectId,
			taskId: selection?.taskId ?? null,
			workItem: selection?.workItem ?? null,
			day,
			startedAt: start && end ? start.toISOString() : null,
			endedAt: start && end ? end.toISOString() : null,
			loggingFor:
				forChoice.autoChoice || forChoice.isPrefill ? null : forChoice.choice,
		});
	};

	if (projects.isEmpty) return null;
	// A failed read is not "nothing to add time to": say so, with Try again.
	if (loggableProjectsFailed(projects)) {
		return (
			<section aria-label={QUICK_ADD_COPY.label} className={className}>
				<LoggableProjectsError projects={projects} />
			</section>
		);
	}

	const dayLabel =
		days.find((d) => d.day === day)?.label ??
		formatLocalDay(day, { weekday: true, userTimezone: timezone });
	const hint = durationInvalid
		? QUICK_ADD_COPY.durationHint
		: start && end && hasWork
			? `${intervalPreview(start, end, timezone)} · ${dayLabel}`
			: null;

	return (
		<section
			aria-label={QUICK_ADD_COPY.label}
			className={cn("space-y-1.5", className)}
		>
			<form
				className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<button
					type="button"
					onClick={() => setWorkOpen(true)}
					className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted sm:max-w-[16rem]"
					aria-haspopup="dialog"
				>
					<ListChecks
						className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					<span className={cn("truncate", !hasWork && "text-muted-foreground")}>
						{workLabel(selection)}
					</span>
					{project ? (
						<span className="truncate text-muted-foreground">
							· {projectTitle(project)}
						</span>
					) : null}
					<ChevronDown
						className="h-3 w-3 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
				</button>

				<label htmlFor={durationId} className="sr-only">
					{QUICK_ADD_COPY.duration}
				</label>
				<input
					id={durationId}
					type="text"
					inputMode="decimal"
					autoComplete="off"
					value={durationText}
					onChange={(event) => setDurationText(event.target.value)}
					placeholder={QUICK_ADD_COPY.durationPlaceholder}
					aria-invalid={durationInvalid || undefined}
					className={cn(
						"w-20 rounded-lg border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25",
						durationInvalid ? "border-destructive" : "border-input",
					)}
				/>

				<button
					ref={dayRef}
					type="button"
					onClick={() => setDayOpen((open) => !open)}
					aria-haspopup="listbox"
					aria-expanded={dayOpen}
					aria-label={`${QUICK_ADD_COPY.day}: ${dayLabel}`}
					className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
				>
					<CalendarDays
						className="h-3.5 w-3.5 text-muted-foreground"
						aria-hidden="true"
					/>
					{dayLabel}
					<ChevronDown
						className="h-3 w-3 text-muted-foreground"
						aria-hidden="true"
					/>
				</button>
				<AnchoredPopover
					anchorRef={dayRef}
					open={dayOpen}
					onClose={() => setDayOpen(false)}
					width={200}
					maxHeight={320}
					zIndex={zIndex}
					ariaLabel={QUICK_ADD_COPY.day}
				>
					<div
						ref={dayListRef}
						role="listbox"
						aria-label={QUICK_ADD_COPY.day}
						className="p-1"
					>
						{days.map((option) => (
							<button
								key={option.day}
								type="button"
								role="option"
								aria-selected={option.day === day}
								aria-disabled={option.disabled || undefined}
								disabled={option.disabled}
								onClick={() => {
									setDayOffset(option.offset);
									setDayOpen(false);
								}}
								className={cn(
									"flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
									option.day === day
										? "bg-primary/10 font-semibold text-foreground"
										: "text-foreground hover:bg-muted",
								)}
							>
								{option.label}
							</button>
						))}
						{windowNote && days.some((option) => option.disabled) ? (
							<p className="px-2.5 pt-1 pb-1.5 text-[11px] text-muted-foreground">
								{windowNote}
							</p>
						) : null}
					</div>
				</AnchoredPopover>

				<ForField
					forChoice={forChoice}
					projectId={projectId}
					mode="add"
					onConfirm={() => void submit()}
					busy={flow.isPending}
					error={
						flow.state.status === "pick" ? flow.state.error?.message : null
					}
					pickerOpen={pickerOpen}
					onPickerOpenChange={setPickerOpen}
					projectWorkspaceName={null}
					zIndex={zIndex}
				/>

				<button
					type="submit"
					disabled={!ready}
					className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{flow.isPending ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
					) : null}
					{forActionLabel(forChoice, "add", QUICK_ADD_COPY.add)}
				</button>

				<button
					type="button"
					onClick={openMore}
					className="ml-auto text-xs font-semibold text-primary transition-colors hover:underline"
				>
					{QUICK_ADD_COPY.moreOptions}
				</button>
			</form>

			<EntryFormNotice
				flow={flow}
				rule={rule.message}
				hint={flow.state.status === "pick" ? null : hint}
				className="px-1"
			/>

			{workOpen ? (
				<TaskPickerModal
					open
					mode="select"
					onClose={() => setWorkOpen(false)}
					initialProjectId={projectId}
					initialTaskId={selection?.taskId ?? null}
					initialWorkItem={selection?.workItem ?? null}
					onSelect={(next) => {
						setSelection(next);
						flow.reset();
					}}
				/>
			) : null}
			{moreOpen ? (
				<ManualEntryModal
					open
					initial={moreOpen}
					onClose={() => setMoreOpen(null)}
					onCreated={(entry) => {
						setDurationText("");
						onAdded?.(entry);
					}}
				/>
			) : null}
		</section>
	);
}
