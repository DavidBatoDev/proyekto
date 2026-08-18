import {
	addMonths,
	eachDayOfInterval,
	endOfMonth,
	endOfWeek,
	format,
	isBefore,
	isSameDay,
	isSameMonth,
	isWithinInterval,
	startOfDay,
	startOfMonth,
	startOfWeek,
} from "date-fns";
import {
	Activity,
	CalendarRange,
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	CircleDollarSign,
	FileSignature,
	FolderKanban,
	type LucideIcon,
	ReceiptText,
	RotateCcw,
	Search,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { CURRENCY_CODE_OPTIONS } from "@/lib/currency";
import {
	activeFilterCount,
	CONTRACT_STATUS_OPTIONS,
	type FinanceSearchState,
	type FinanceSection,
	formatDateRange,
	INVOICE_STATUS_OPTIONS,
	PROJECT_STATUS_OPTIONS,
	parseYmd,
	SECTION_FILTERS,
	toIsoDate,
} from "./financeSearch";

/**
 * The filter toolbar above every finance section.
 *
 * `section` is passed in rather than read off a `?tab=` param: the sections are
 * separate routes now, so the component cannot infer which status facet to
 * offer from the search state alone.
 *
 * Only the facets that actually reach the section's query are rendered (see
 * SECTION_FILTERS). The bar previously showed all four everywhere while the
 * engagements query passed on only `project_id` and the project-scoped invoice
 * workbench read none of them, so three controls were decorative — a user could
 * pick a currency, watch nothing change, and have no way to tell why.
 */
export function FinanceFiltersBar({
	search,
	section,
	projects,
	onChange,
}: {
	search: FinanceSearchState;
	section: FinanceSection;
	projects: Array<{ id: string; title: string }>;
	onChange: (patch: Partial<FinanceSearchState>) => void;
}) {
	const allowed = SECTION_FILTERS[section];
	// A project-scoped invoice view is its own workbench and reads none of these.
	const scopedToProjectWorkbench =
		Boolean(search.projectId) &&
		(section === "invoices" || section === "overview");
	const count = activeFilterCount(search, section);
	// Changing any facet returns to the first page: page 3 of the old result set
	// is rarely a page of the new one, and is often past its end.
	const update = (patch: Partial<FinanceSearchState>) =>
		onChange({ ...patch, page: undefined });
	const clearFilters = () =>
		update({
			q: undefined,
			projectId: undefined,
			projectStatus: undefined,
			currency: undefined,
			from: undefined,
			to: undefined,
			contractStatus: undefined,
			invoiceStatus: undefined,
			step: undefined,
		});

	if (scopedToProjectWorkbench) return null;

	return (
		<div className="relative my-4 rounded-xl border border-border bg-card p-3 shadow-sm">
			<div
				role="toolbar"
				aria-label="Finance filters"
				className="flex flex-col gap-3 lg:flex-row lg:items-center"
			>
				{allowed.search && (
					<div className="relative min-w-0 flex-1 lg:max-w-sm">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							aria-label="Search projects"
							value={search.q ?? ""}
							onChange={(event) =>
								update({ q: event.target.value || undefined })
							}
							placeholder="Search projects…"
							className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
						/>
						{search.q && (
							<button
								type="button"
								aria-label="Clear project search"
								onClick={() => update({ q: undefined })}
								className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						)}
					</div>
				)}

				<div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5">
					{allowed.project && (
						<FinanceFacetFilter
							icon={FolderKanban}
							label="Project"
							emptyLabel="All projects"
							value={search.projectId}
							onChange={(projectId) => update({ projectId })}
							searchable
							options={projects.map((project) => ({
								value: project.id,
								label: project.title,
							}))}
						/>
					)}
					{allowed.projectStatus && (
						<FinanceFacetFilter
							icon={Activity}
							label="Status"
							emptyLabel="Any project status"
							value={search.projectStatus}
							onChange={(projectStatus) => update({ projectStatus })}
							options={PROJECT_STATUS_OPTIONS}
						/>
					)}
					{allowed.currency && (
						<FinanceFacetFilter
							icon={CircleDollarSign}
							label="Currency"
							emptyLabel="All currencies"
							value={search.currency}
							onChange={(currency) => update({ currency })}
							options={CURRENCY_CODE_OPTIONS.map((value) => ({
								value,
								label: value,
							}))}
						/>
					)}
					{allowed.date && (
						<FinanceDateFilter
							from={search.from}
							to={search.to}
							onChange={update}
						/>
					)}
					{allowed.contractStatus && (
						<FinanceFacetFilter
							icon={FileSignature}
							label="Contract"
							emptyLabel="Any contract status"
							value={search.contractStatus}
							onChange={(contractStatus) => update({ contractStatus })}
							options={CONTRACT_STATUS_OPTIONS}
						/>
					)}
					{allowed.invoiceStatus && (
						<FinanceFacetFilter
							icon={ReceiptText}
							label="Invoice"
							emptyLabel="Any invoice status"
							value={search.invoiceStatus}
							onChange={(invoiceStatus) => update({ invoiceStatus })}
							options={INVOICE_STATUS_OPTIONS}
						/>
					)}
				</div>
			</div>
			{count > 0 && (
				<button
					type="button"
					onClick={clearFilters}
					className="absolute -top-3 right-3 inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
				>
					<RotateCcw className="h-3.5 w-3.5" />
					Reset
				</button>
			)}
		</div>
	);
}

interface FinanceFilterOption {
	value: string;
	label: string;
}

function FinanceFacetFilter({
	icon: Icon,
	label,
	emptyLabel,
	value,
	onChange,
	options,
	searchable = false,
}: {
	icon: LucideIcon;
	label: string;
	emptyLabel: string;
	value?: string;
	onChange: (value: string | undefined) => void;
	options: FinanceFilterOption[];
	searchable?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const triggerRef = useRef<HTMLButtonElement>(null);
	const selected = options.find((option) => option.value === value);
	const visibleOptions = query
		? options.filter((option) =>
				option.label.toLowerCase().includes(query.toLowerCase()),
			)
		: options;
	const close = () => {
		setOpen(false);
		setQuery("");
	};
	const select = (nextValue?: string) => {
		onChange(nextValue);
		close();
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
				className={`inline-flex h-9 max-w-full items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm outline-none transition-colors focus:ring-2 focus:ring-primary/20 ${
					selected
						? "border-primary/30 bg-primary/5 text-foreground"
						: "border-dashed border-input bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
				}`}
			>
				<Icon className="h-3.5 w-3.5 shrink-0" />
				<span>{label}</span>
				{selected && (
					<>
						<span className="mx-0.5 h-4 w-px bg-border" />
						<span className="max-w-32 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground">
							{selected.label}
						</span>
					</>
				)}
				<ChevronDown
					className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>

			<AnchoredPopover
				anchorRef={triggerRef}
				open={open}
				onClose={close}
				width={searchable ? 280 : 240}
				maxHeight={360}
				ariaLabel={`${label} filter`}
				className="overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
			>
				{searchable && (
					<div className="border-b border-border p-2">
						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
							<input
								autoFocus
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder={`Search ${label.toLowerCase()}s…`}
								className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
							/>
						</div>
					</div>
				)}
				<div role="listbox" className="max-h-72 overflow-y-auto p-1">
					<FinanceFilterOptionRow
						label={emptyLabel}
						selected={!value}
						onClick={() => select(undefined)}
					/>
					{visibleOptions.map((option) => (
						<FinanceFilterOptionRow
							key={option.value}
							label={option.label}
							selected={option.value === value}
							onClick={() => select(option.value)}
						/>
					))}
					{visibleOptions.length === 0 && (
						<p className="px-3 py-6 text-center text-xs text-muted-foreground">
							No matches found
						</p>
					)}
				</div>
			</AnchoredPopover>
		</>
	);
}

function FinanceFilterOptionRow({
	label,
	selected,
	onClick,
}: {
	label: string;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="option"
			aria-selected={selected}
			onClick={onClick}
			className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted"
		>
			<span
				className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
					selected
						? "border-primary bg-primary text-primary-foreground"
						: "border-input bg-background"
				}`}
			>
				{selected && <Check className="h-3 w-3" />}
			</span>
			<span className="truncate">{label}</span>
		</button>
	);
}

function FinanceDateFilter({
	from,
	to,
	onChange,
}: {
	from?: string;
	to?: string;
	onChange: (patch: Partial<FinanceSearchState>) => void;
}) {
	const [open, setOpen] = useState(false);
	const [draftStart, setDraftStart] = useState<Date | null>(null);
	const [draftEnd, setDraftEnd] = useState<Date | null>(null);
	const [hoveredDay, setHoveredDay] = useState<Date | null>(null);
	const [viewMonth, setViewMonth] = useState(() =>
		startOfMonth(parseYmd(from) ?? new Date()),
	);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const active = Boolean(from || to);
	const rangeLabel = formatDateRange(from, to);

	useEffect(() => {
		if (!open) return;
		const start = parseYmd(from);
		setDraftStart(start);
		setDraftEnd(parseYmd(to));
		setHoveredDay(null);
		setViewMonth(startOfMonth(start ?? new Date()));
	}, [open, from, to]);

	const pickDay = (day: Date) => {
		if (!draftStart || draftEnd) {
			setDraftStart(day);
			setDraftEnd(null);
			return;
		}
		if (isBefore(day, draftStart)) {
			setDraftEnd(draftStart);
			setDraftStart(day);
			return;
		}
		setDraftEnd(day);
	};

	const applyDraft = () => {
		if (!draftStart || !draftEnd) return;
		onChange({ from: toIsoDate(draftStart), to: toIsoDate(draftEnd) });
		setOpen(false);
	};

	const applyPreset = (preset: "month" | "30-days" | "year") => {
		const today = new Date();
		let start: Date;
		if (preset === "month") {
			start = new Date(today.getFullYear(), today.getMonth(), 1);
		} else if (preset === "year") {
			start = new Date(today.getFullYear(), 0, 1);
		} else {
			start = new Date(today);
			start.setDate(today.getDate() - 29);
		}
		onChange({ from: toIsoDate(start), to: toIsoDate(today) });
		setOpen(false);
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
				className={`inline-flex h-9 max-w-full items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm outline-none transition-colors focus:ring-2 focus:ring-primary/20 ${
					active
						? "border-primary/30 bg-primary/5 text-foreground"
						: "border-dashed border-input bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
				}`}
			>
				<CalendarRange className="h-3.5 w-3.5 shrink-0" />
				<span>Date</span>
				{active && (
					<>
						<span className="mx-0.5 h-4 w-px bg-border" />
						<span className="truncate rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground">
							{rangeLabel}
						</span>
					</>
				)}
				<ChevronDown
					className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>

			<AnchoredPopover
				anchorRef={triggerRef}
				open={open}
				onClose={() => setOpen(false)}
				width={
					typeof window !== "undefined" && window.innerWidth < 640
						? Math.min(336, window.innerWidth - 16)
						: 620
				}
				maxHeight={520}
				ariaLabel="Date range filter"
				className="overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
			>
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<div>
						<p className="text-sm font-semibold text-foreground">
							Select range
						</p>
						<p className="mt-0.5 text-xs text-muted-foreground">
							Choose a start and end date
						</p>
					</div>
					{active && (
						<button
							type="button"
							onClick={() => {
								onChange({ from: undefined, to: undefined });
								setOpen(false);
							}}
							className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							Clear
						</button>
					)}
				</div>

				<div className="grid gap-5 p-4 sm:grid-cols-2">
					<div className="relative">
						<button
							type="button"
							onClick={() => setViewMonth((month) => addMonths(month, -1))}
							aria-label="Previous month"
							className="absolute left-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							<ChevronLeft className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() => setViewMonth((month) => addMonths(month, 1))}
							aria-label="Next month"
							className="absolute right-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:hidden"
						>
							<ChevronRight className="h-4 w-4" />
						</button>
						<FinanceMonthGrid
							month={viewMonth}
							draftStart={draftStart}
							draftEnd={draftEnd}
							hoveredDay={hoveredDay}
							onHover={setHoveredDay}
							onPick={pickDay}
						/>
					</div>
					<div className="relative hidden sm:block">
						<button
							type="button"
							onClick={() => setViewMonth((month) => addMonths(month, 1))}
							aria-label="Next month"
							className="absolute right-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							<ChevronRight className="h-4 w-4" />
						</button>
						<FinanceMonthGrid
							month={addMonths(viewMonth, 1)}
							draftStart={draftStart}
							draftEnd={draftEnd}
							hoveredDay={hoveredDay}
							onHover={setHoveredDay}
							onPick={pickDay}
						/>
					</div>
				</div>

				<div className="border-t border-border bg-muted/20 px-4 py-3">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
							Quick ranges
						</span>
						{[
							{ value: "30-days" as const, label: "Last 30 days" },
							{ value: "month" as const, label: "This month" },
							{ value: "year" as const, label: "This year" },
						].map((preset) => (
							<button
								type="button"
								key={preset.value}
								onClick={() => applyPreset(preset.value)}
								className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
							>
								{preset.label}
							</button>
						))}
					</div>
					<div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
						<p className="min-w-0 truncate text-xs text-muted-foreground">
							{draftStart
								? `${format(draftStart, "MMM d, yyyy")} – ${draftEnd ? format(draftEnd, "MMM d, yyyy") : "Select end date"}`
								: "Select a start date"}
						</p>
						<div className="flex shrink-0 items-center gap-2">
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={applyDraft}
								disabled={!draftStart || !draftEnd}
								className="rounded-md bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
							>
								Apply range
							</button>
						</div>
					</div>
				</div>
			</AnchoredPopover>
		</>
	);
}

const FINANCE_WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function FinanceMonthGrid({
	month,
	draftStart,
	draftEnd,
	hoveredDay,
	onHover,
	onPick,
}: {
	month: Date;
	draftStart: Date | null;
	draftEnd: Date | null;
	hoveredDay: Date | null;
	onHover: (day: Date | null) => void;
	onPick: (day: Date) => void;
}) {
	const days = useMemo(() => {
		const firstDay = startOfWeek(startOfMonth(month));
		return eachDayOfInterval({
			start: firstDay,
			end: endOfWeek(endOfMonth(month)),
		});
	}, [month]);
	const previewEnd = draftEnd ?? (draftStart ? hoveredDay : null);
	let rangeStart = draftStart;
	let rangeEnd = previewEnd;
	if (rangeStart && rangeEnd && isBefore(rangeEnd, rangeStart)) {
		[rangeStart, rangeEnd] = [rangeEnd, rangeStart];
	}

	return (
		<div>
			<h3 className="flex h-8 items-center justify-center px-9 text-sm font-semibold text-foreground">
				{format(month, "MMMM yyyy")}
			</h3>
			<div className="mt-2 grid grid-cols-7">
				{FINANCE_WEEKDAYS.map((weekday) => (
					<div
						key={weekday}
						className="flex h-8 items-center justify-center text-[11px] font-medium text-muted-foreground"
					>
						{weekday}
					</div>
				))}
				{days.map((day) => {
					const isStart = Boolean(draftStart && isSameDay(day, draftStart));
					const isEnd = Boolean(draftEnd && isSameDay(day, draftEnd));
					const isEndpoint = isStart || isEnd;
					const inRange = Boolean(
						rangeStart &&
							rangeEnd &&
							isWithinInterval(day, {
								start: startOfDay(rangeStart),
								end: startOfDay(rangeEnd),
							}),
					);
					const inMonth = isSameMonth(day, month);
					const today = isSameDay(day, new Date());
					return (
						<button
							type="button"
							key={toIsoDate(day)}
							onMouseEnter={() => onHover(day)}
							onMouseLeave={() => onHover(null)}
							onFocus={() => onHover(day)}
							onClick={() => onPick(day)}
							aria-label={format(day, "MMMM d, yyyy")}
							aria-pressed={isEndpoint}
							className={`relative flex h-9 items-center justify-center text-xs transition-colors ${
								isEndpoint
									? "z-10 rounded-md bg-primary font-semibold text-primary-foreground shadow-sm"
									: inRange
										? "bg-primary/10 font-medium text-foreground"
										: inMonth
											? "rounded-md text-foreground hover:bg-muted"
											: "rounded-md text-muted-foreground/45 hover:bg-muted/60"
							} ${today && !isEndpoint ? "font-semibold ring-1 ring-inset ring-primary/40" : ""}`}
						>
							{format(day, "d")}
						</button>
					);
				})}
			</div>
		</div>
	);
}
