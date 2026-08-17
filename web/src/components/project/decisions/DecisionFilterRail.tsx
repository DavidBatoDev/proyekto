import { ChevronDown, ChevronUp, Settings2, Tag, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	CATEGORY_ACCENT,
	CATEGORY_ICON,
	categoryCounts,
	uncategorizedCount,
} from "@/components/project/delivery/decisionModel";
import type { Decision, DecisionCategory } from "@/services/delivery.service";
import {
	type DecisionFilters,
	hasActiveDecisionFilters,
	NO_DECISION_FILTERS,
} from "./decisionLog";

/** Rows shown before a facet collapses behind "+N more". */
const VISIBLE_ROWS = 4;

/**
 * The log's faceted filter.
 *
 * Checkboxes rather than a one-of-many list, because "Technical and Design" is a
 * question people actually ask of a decision log. Nothing checked means no
 * filter, which is why there is no "Any" row — unchecking everything already
 * says it.
 *
 * Counts sit beside every row and are computed from the WHOLE log, not the
 * filtered view: a facet count that shrank as you ticked boxes would make the
 * remaining options look empty and stop you exploring.
 *
 * The section/checkbox shapes follow `logs/LogsFilterSidebar.tsx`, the app's
 * existing faceted filter, so the two read as the same control.
 */
export function DecisionFilterRail({
	decisions,
	categories,
	filters,
	onChange,
	onManage,
	canEdit,
	onClose,
}: {
	decisions: Decision[];
	categories: DecisionCategory[];
	filters: DecisionFilters;
	onChange: (next: DecisionFilters) => void;
	onManage: () => void;
	canEdit: boolean;
	/** Set in the mobile sheet, which needs a way out. */
	onClose?: () => void;
}) {
	const counts = categoryCounts(decisions, categories);
	const uncategorized = uncategorizedCount(decisions);
	const byStatus = (value: Decision["status"]) =>
		decisions.filter((decision) => decision.status === value).length;

	const toggleStatus = (value: Decision["status"]) =>
		onChange({
			...filters,
			statuses: filters.statuses.includes(value)
				? filters.statuses.filter((v) => v !== value)
				: [...filters.statuses, value],
		});

	const toggleCategory = (value: string) =>
		onChange({
			...filters,
			categoryIds: filters.categoryIds.includes(value)
				? filters.categoryIds.filter((v) => v !== value)
				: [...filters.categoryIds, value],
		});

	const categoryRows = [
		...counts.map(({ category, count }) => ({
			key: category.id,
			label: category.name,
			count,
			glyph: <CategoryGlyph category={category} />,
		})),
		...(uncategorized > 0
			? [
					{
						key: "",
						label: "Uncategorised",
						count: uncategorized,
						glyph: <Tag className="h-3.5 w-3.5 text-muted-foreground" />,
					},
				]
			: []),
	];

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between px-4 py-3">
				<span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
					Filters
				</span>
				<div className="flex items-center gap-1">
					<button
						type="button"
						disabled={!hasActiveDecisionFilters(filters)}
						onClick={() => onChange(NO_DECISION_FILTERS)}
						className="text-[11px] font-medium text-primary transition-opacity hover:underline disabled:opacity-40 disabled:no-underline"
					>
						Reset
					</button>
					{onClose && (
						<button
							type="button"
							onClick={onClose}
							aria-label="Close filters"
							className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
			</div>

			<div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
				<Facet title="Status" selected={filters.statuses.length}>
					{(["proposed", "final", "superseded"] as const).map((value) => (
						<CheckRow
							key={value}
							checked={filters.statuses.includes(value)}
							onToggle={() => toggleStatus(value)}
							count={byStatus(value)}
						>
							{value === "proposed"
								? "Proposed"
								: value === "final"
									? "Final"
									: "Superseded"}
						</CheckRow>
					))}
				</Facet>

				<Facet title="Category" selected={filters.categoryIds.length}>
					{categoryRows.length === 0 ? (
						<p className="px-1 py-1 text-xs text-muted-foreground">
							No categories yet.
						</p>
					) : (
						<Collapsing rows={categoryRows.length}>
							{(limit) =>
								categoryRows.slice(0, limit).map((row) => (
									<CheckRow
										key={row.key}
										checked={filters.categoryIds.includes(row.key)}
										onToggle={() => toggleCategory(row.key)}
										count={row.count}
										glyph={row.glyph}
									>
										{row.label}
									</CheckRow>
								))
							}
						</Collapsing>
					)}
				</Facet>
			</div>

			{canEdit && (
				<div className="border-t border-border px-4 py-2.5">
					<button
						type="button"
						onClick={onManage}
						className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						<Settings2 className="h-3.5 w-3.5" />
						{categories.length === 0 ? "Add categories" : "Manage categories"}
					</button>
				</div>
			)}
		</div>
	);
}

function CategoryGlyph({ category }: { category: DecisionCategory }) {
	const Icon = CATEGORY_ICON[category.icon] ?? Tag;
	return (
		<span
			className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${CATEGORY_ACCENT[category.color]}`}
		>
			<Icon className="h-2.5 w-2.5" />
		</span>
	);
}

/**
 * A collapsible facet. Open by default — a filter you have to unfold before you
 * can see what it offers is a filter most people never touch.
 */
function Facet({
	title,
	selected,
	children,
}: {
	title: string;
	/** How many rows in this facet are checked, shown while it is collapsed. */
	selected: number;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(true);
	const Chevron = open ? ChevronUp : ChevronDown;

	return (
		<div className="border-b border-border/60 px-4 py-3 last:border-b-0">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				className="flex w-full items-center gap-2 text-left"
			>
				<span className="flex-1 text-sm font-semibold text-foreground">
					{title}
				</span>
				{!open && selected > 0 && (
					<span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
						{selected}
					</span>
				)}
				<Chevron className="h-4 w-4 shrink-0 text-foreground" />
			</button>
			{open && <div className="mt-2 space-y-0.5">{children}</div>}
		</div>
	);
}

/** Shows the first few rows and reveals the rest behind "+N more". */
function Collapsing({
	rows,
	children,
}: {
	rows: number;
	children: (limit: number) => ReactNode;
}) {
	const [expanded, setExpanded] = useState(false);
	const hidden = rows - VISIBLE_ROWS;

	return (
		<>
			{children(expanded ? rows : VISIBLE_ROWS)}
			{hidden > 0 && (
				<button
					type="button"
					onClick={() => setExpanded((value) => !value)}
					className="mt-1 px-1 text-xs font-medium text-foreground underline underline-offset-2 hover:no-underline"
				>
					{expanded ? "Show less" : `+${hidden} more`}
				</button>
			)}
		</>
	);
}

function CheckRow({
	checked,
	onToggle,
	count,
	glyph,
	children,
}: {
	checked: boolean;
	onToggle: () => void;
	count: number;
	glyph?: ReactNode;
	children: ReactNode;
}) {
	return (
		<label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm transition-colors hover:bg-muted/60">
			<input
				type="checkbox"
				checked={checked}
				onChange={onToggle}
				className="h-4 w-4 shrink-0 rounded border-input accent-primary"
			/>
			{glyph}
			<span className="min-w-0 flex-1 truncate text-foreground">
				{children}
			</span>
			{/* Parenthesised and muted: the count is context for the label, not a
			    value in its own right. */}
			<span className="shrink-0 tabular-nums text-muted-foreground">
				({count})
			</span>
		</label>
	);
}
