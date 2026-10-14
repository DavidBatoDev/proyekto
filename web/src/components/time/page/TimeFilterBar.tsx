// web/src/components/time/page/TimeFilterBar.tsx
//
// The My time tab's filters (they replace the old week strip):
//
//   [‹] [📅 This week · Oct 19 – 25] [›]  [Project ▾] [For ▾] [🔍 Search tasks/notes]  ⟲ Clear      ⓘ ⚙
//
// - The dates: one trigger opens the DateRangePicker (two Monday-first
//   months and the presets Today … Last 30 days). ‹ › step by the active
//   period: a Monday week, a calendar month, or the range's own length;
//   `j`/`k` step and `t` comes back to this week.
// - Project, For (only with more than one choice; the page passes the
//   existing `ForFilter`), a search over task titles and notes, and Status
//   (only where time is approved).
// - Clear resets every filter, the dates included.
// - Below 640 px the filters fold behind one "Filters" button whose badge
//   counts the active ones; ‹ dates › stay on the page (the picker opens
//   as a bottom sheet there).
//
// Everything lives in the URL (`lib/timeSearch.ts`): this bar only writes
// patches through `onSearchChange`.

import {
	ChevronLeft,
	ChevronRight,
	Info,
	RotateCcw,
	Search,
	SlidersHorizontal,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { overlayOpen } from "@/lib/overlayOpen";
import { MAX_VIEW_RANGE_DAYS, stepRange } from "@/lib/timePeriods";
import {
	TIME_REPORT_STATUSES,
	type TimePageSearch,
	type TimeReportStatus,
} from "@/lib/timeSearch";
import { cn } from "@/lib/utils";
import { sheetStatusWord } from "../entries/entryRules";
import { DateRangePicker } from "./DateRangePicker";
import { TIME_PREFS_COPY } from "./TimePrefsMenu";
import { presetSearch, rangeSearch, type ViewRange } from "./useTimePageData";

export const TIME_FILTERS_COPY = {
	region: "Time filters",
	previous: "Previous period",
	next: "Next period",
	project: "Project",
	allProjects: "All projects",
	search: "Search tasks and notes",
	searchPlaceholder: "Search tasks/notes",
	status: "Status",
	allStatuses: "Any status",
	clear: "Clear",
	filters: "Filters",
	filtersActive: (n: number) => `Filters, ${n} active`,
	capped: `Showing the first ${Math.round(MAX_VIEW_RANGE_DAYS / 31)} months of this range. Pick a shorter range to see the rest.`,
	/** ux.md's ⓘ tooltip. */
	zoneHint: TIME_PREFS_COPY.hint,
} as const;

/** A filter-bar project choice. */
export interface TimeFilterProject {
	id: string;
	title: string;
}

export interface TimeFilterBarProps {
	search: TimePageSearch;
	onSearchChange: (patch: Partial<TimePageSearch>) => void;
	range: ViewRange;
	today: string;
	projects: readonly TimeFilterProject[];
	/** The For filter (`ForFilter`), or null when there's nothing to choose. */
	forFilter?: ReactNode;
	/** The For filter is set (it counts as active). */
	forActive?: boolean;
	/** Offer the status filter (the workspace approves time). */
	showStatus?: boolean;
	/** "Your time (Asia/Manila)"; null hides it. */
	zoneText?: string | null;
	/** The ⚙ menu (TimePrefsMenu). */
	settings?: ReactNode;
	/** Below 640 px: the filters fold behind "Filters". */
	compact?: boolean;
	/** `j` / `k` / `t` (default on). */
	shortcuts?: boolean;
}

const ICON_BUTTON =
	"inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 max-sm:h-10 max-sm:w-10";
const CONTROL =
	"h-8 rounded-lg border border-input bg-card px-2 text-xs font-semibold text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 max-sm:h-10 max-sm:w-full";
const LABEL = "text-xs font-medium text-muted-foreground";

/** How many of the folded filters are set (the phone button's badge; the dates stay outside). */
export function activeFilterCount(
	search: Pick<TimePageSearch, "project" | "for" | "q" | "status">,
): number {
	return (
		(search.project ? 1 : 0) +
		(search.for ? 1 : 0) +
		(search.q?.trim() ? 1 : 0) +
		(search.status ? 1 : 0)
	);
}

/** The patch Clear writes: every filter, the dates included, back to the default. */
export const CLEAR_FILTERS: Partial<TimePageSearch> = {
	week: undefined,
	preset: undefined,
	from: undefined,
	to: undefined,
	project: undefined,
	for: undefined,
	q: undefined,
	status: undefined,
};

export function TimeFilterBar({
	search,
	onSearchChange,
	range,
	today,
	projects,
	forFilter,
	forActive = false,
	showStatus = false,
	zoneText,
	settings,
	compact = false,
	shortcuts = true,
}: TimeFilterBarProps) {
	const step = (n: number) =>
		onSearchChange(
			rangeSearch(stepRange(range, range.unit, n), range.unit, today),
		);
	const goToday = () => onSearchChange(presetSearch("this_week", range));
	useWeekShortcuts(
		{ previous: () => step(-1), next: () => step(1), today: goToday },
		shortcuts,
	);
	const count = activeFilterCount(search);
	const canClear = count > 0 || forActive || !range.isDefault;

	const nav = (
		<div
			className="flex min-w-0 items-center gap-1.5 max-sm:basis-full max-sm:justify-between"
			data-testid="time-range-nav"
		>
			<button
				type="button"
				className={ICON_BUTTON}
				onClick={() => step(-1)}
				aria-label={TIME_FILTERS_COPY.previous}
				title={`${TIME_FILTERS_COPY.previous} (k)`}
			>
				<ChevronLeft className="h-4 w-4" aria-hidden="true" />
			</button>
			<DateRangePicker
				range={range}
				preset={range.preset}
				today={today}
				compact={compact}
				onApply={(next) =>
					onSearchChange({
						week: undefined,
						preset: undefined,
						from: next.start,
						to: next.end,
					})
				}
				onPreset={(preset) => onSearchChange(presetSearch(preset, range))}
			/>
			<button
				type="button"
				className={ICON_BUTTON}
				onClick={() => step(1)}
				aria-label={TIME_FILTERS_COPY.next}
				title={`${TIME_FILTERS_COPY.next} (j)`}
			>
				<ChevronRight className="h-4 w-4" aria-hidden="true" />
			</button>
		</div>
	);

	const controls = (
		<FilterControls
			search={search}
			onSearchChange={onSearchChange}
			projects={projects}
			forFilter={forFilter}
			showStatus={showStatus}
			canClear={canClear}
			stacked={compact}
		/>
	);

	const trailing = (
		<div className="ml-auto flex min-w-0 items-center gap-2">
			{zoneText ? (
				<ZoneLabel text={zoneText} className="hidden sm:inline-flex" />
			) : null}
			{settings}
		</div>
	);

	return (
		<div className="space-y-2">
			<nav
				aria-label={TIME_FILTERS_COPY.region}
				className="flex flex-wrap items-center gap-x-3 gap-y-2"
				data-testid="time-filters"
			>
				{nav}
				{compact ? (
					<PhoneFilters count={count}>{controls}</PhoneFilters>
				) : (
					controls
				)}
				{trailing}
			</nav>
			{zoneText ? <ZoneLabel text={zoneText} className="sm:hidden" /> : null}
			{range.capped ? (
				<p
					className="text-xs text-muted-foreground"
					data-testid="time-range-capped"
				>
					{TIME_FILTERS_COPY.capped}
				</p>
			) : null}
		</div>
	);
}

// ── Controls ────────────────────────────────────────────────────────────────

function FilterControls({
	search,
	onSearchChange,
	projects,
	forFilter,
	showStatus,
	canClear,
	stacked,
}: {
	search: TimePageSearch;
	onSearchChange: (patch: Partial<TimePageSearch>) => void;
	projects: readonly TimeFilterProject[];
	forFilter?: ReactNode;
	showStatus: boolean;
	canClear: boolean;
	stacked: boolean;
}) {
	const id = useId();
	const field = (labelText: string, htmlFor: string, control: ReactNode) => (
		<span
			className={cn(
				"inline-flex items-center gap-1.5",
				stacked && "flex w-full flex-col items-stretch gap-1",
			)}
		>
			<label htmlFor={htmlFor} className={stacked ? LABEL : "sr-only"}>
				{labelText}
			</label>
			{control}
		</span>
	);
	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-2",
				stacked && "flex-col items-stretch gap-3",
			)}
			data-testid="time-filter-controls"
		>
			{projects.length > 0 || search.project
				? field(
						TIME_FILTERS_COPY.project,
						`${id}-project`,
						<select
							id={`${id}-project`}
							value={search.project ?? ""}
							onChange={(event) =>
								onSearchChange({
									project: event.currentTarget.value || undefined,
								})
							}
							className={cn(
								CONTROL,
								"max-w-[14rem] truncate max-sm:max-w-none",
							)}
							data-testid="time-project-filter"
						>
							<option value="">{TIME_FILTERS_COPY.allProjects}</option>
							{projects.map((project) => (
								<option key={project.id} value={project.id}>
									{project.title}
								</option>
							))}
						</select>,
					)
				: null}
			{forFilter ?? null}
			<SearchBox
				id={`${id}-search`}
				value={search.q ?? ""}
				onChange={(q) => onSearchChange({ q: q || undefined })}
				stacked={stacked}
			/>
			{showStatus
				? field(
						TIME_FILTERS_COPY.status,
						`${id}-status`,
						<select
							id={`${id}-status`}
							value={search.status ?? ""}
							onChange={(event) =>
								onSearchChange({
									status:
										(event.currentTarget.value as TimeReportStatus) ||
										undefined,
								})
							}
							className={CONTROL}
							data-testid="time-status-filter"
						>
							<option value="">{TIME_FILTERS_COPY.allStatuses}</option>
							{TIME_REPORT_STATUSES.map((status) => (
								<option key={status} value={status}>
									{sheetStatusWord(status)}
								</option>
							))}
						</select>,
					)
				: null}
			{canClear ? (
				<button
					type="button"
					onClick={() => onSearchChange(CLEAR_FILTERS)}
					className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 max-sm:h-10 max-sm:justify-center"
					data-testid="time-filters-clear"
				>
					<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
					{TIME_FILTERS_COPY.clear}
				</button>
			) : null}
		</div>
	);
}

/** The search box: typed text reaches the URL after a short pause. */
function SearchBox({
	id,
	value,
	onChange,
	stacked,
}: {
	id: string;
	value: string;
	onChange: (q: string) => void;
	stacked: boolean;
}) {
	const [draft, setDraft] = useState(value);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	// The URL changed elsewhere (Clear, back): show it.
	useEffect(() => {
		setDraft(value);
	}, [value]);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	const commit = (next: string) => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		if (next.trim() !== value.trim()) onChangeRef.current(next.trim());
	};
	return (
		<span
			className={cn(
				"relative inline-flex items-center",
				stacked && "flex w-full flex-col items-stretch gap-1",
			)}
		>
			<label htmlFor={id} className={stacked ? LABEL : "sr-only"}>
				{TIME_FILTERS_COPY.search}
			</label>
			<span className="relative inline-flex w-full items-center">
				<Search
					className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground"
					aria-hidden="true"
				/>
				<input
					id={id}
					type="search"
					value={draft}
					placeholder={TIME_FILTERS_COPY.searchPlaceholder}
					onChange={(event) => {
						const next = event.currentTarget.value;
						setDraft(next);
						if (timer.current) clearTimeout(timer.current);
						timer.current = setTimeout(() => commit(next), 250);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") commit(draft);
					}}
					onBlur={() => commit(draft)}
					className={cn(CONTROL, "w-48 pl-7 font-normal max-sm:w-full")}
					data-testid="time-search"
				/>
			</span>
		</span>
	);
}

/** Phones: one "Filters" button with the active count; the controls open in a popover. */
function PhoneFilters({
	count,
	children,
}: {
	count: number;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label={
					count > 0
						? TIME_FILTERS_COPY.filtersActive(count)
						: TIME_FILTERS_COPY.filters
				}
				onClick={() => setOpen((value) => !value)}
				className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
				data-testid="time-filters-button"
			>
				<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
				{TIME_FILTERS_COPY.filters}
				{count > 0 ? (
					<span
						className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground"
						data-testid="time-filters-count"
					>
						{count}
					</span>
				) : null}
			</button>
			<AnchoredPopover
				anchorRef={triggerRef}
				open={open}
				onClose={() => setOpen(false)}
				width={320}
				maxHeight={520}
				align="left"
				ariaLabel={TIME_FILTERS_COPY.filters}
			>
				<div className="p-3" data-testid="time-filters-popover">
					{children}
				</div>
			</AnchoredPopover>
		</>
	);
}

/** The zone label with its ⓘ. */
export function ZoneLabel({
	text,
	className,
}: {
	text: string;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground",
				className,
			)}
			data-testid="time-zone-label"
		>
			<span className="truncate">{text}</span>
			<span title={TIME_FILTERS_COPY.zoneHint} className="inline-flex shrink-0">
				<Info className="h-3.5 w-3.5" aria-hidden="true" />
				<span className="sr-only">{TIME_FILTERS_COPY.zoneHint}</span>
			</span>
		</span>
	);
}

// ── Keyboard ────────────────────────────────────────────────────────────────

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		target.closest("[contenteditable='true']") !== null
	);
}

/**
 * `j` next period, `k` previous period, `t` this week (Google Calendar's
 * keys). Ignored while typing, with a modifier key held, or while a dialog,
 * popover or menu is open.
 */
export function useWeekShortcuts(
	handlers: { previous: () => void; next: () => void; today: () => void },
	enabled = true,
): void {
	const ref = useRef(handlers);
	ref.current = handlers;
	useEffect(() => {
		if (!enabled) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.repeat) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (isTypingTarget(event.target) || overlayOpen()) return;
			const key = event.key.toLowerCase();
			if (key === "j") ref.current.next();
			else if (key === "k") ref.current.previous();
			else if (key === "t") ref.current.today();
			else return;
			event.preventDefault();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [enabled]);
}
