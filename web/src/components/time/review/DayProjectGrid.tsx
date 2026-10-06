// web/src/components/time/review/DayProjectGrid.tsx
//
// The review screen's read-only grid (ux.md › Approvals › Review screen):
//
//   ┌──────────────────────────┬─────┬─────┬─────┬──────┬─────┬────┬────┬───────┐
//   │                          │ Mon │ Tue │ Wed │ Thu  │ Fri │ Sat│ Sun│ Total │
//   │ Acme Website             │ 4:00│ 6:30│ 5:15│ 8:10⚠│ 3:00│    │    │ 26:55 │
//   │ Projects you can't open  │ 1:00│     │ 0:20│      │ 1:00│    │    │  2:20 │
//   │ Total                    │ 7:00│ 8:00│ 7:35│11:40⚠│ 4:00│    │    │ 38:15 │
//   └──────────────────────────┴─────┴─────┴─────┴──────┴─────┴────┴────┴───────┘
//
// The only grid in Time: entries are intervals, so the logging side never
// shows one. Days are the sheet's own, in its timezone. A cell, a row total
// or a day total filters the entries below to that project and/or day; a
// merged cell ("Projects you can't open", L21) filters to the merged rows.
// Pressing the active cell again clears the filter. A day over 8 h shows ⚠.
//
// Below 640 px the review screen renders MobileDayCards instead.

import { AlertTriangle } from "lucide-react";
import { formatClock } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import {
	dayColumnLabel,
	dayFullName,
	isOverDay,
	REVIEW_COPY,
	type ReviewFilter,
	type ReviewGrid,
} from "./reviewModel";

export interface DayProjectGridProps {
	grid: ReviewGrid;
	/** The active filter (its cell reads as pressed). */
	filter: ReviewFilter | null;
	/** A cell, row total or day total was pressed (null: clear). */
	onFilter: (filter: ReviewFilter | null) => void;
	now?: Date;
	userTimezone?: string;
	className?: string;
}

function sameFilter(
	a: ReviewFilter | null,
	rowKey: string | null,
	date: string | null,
): boolean {
	return (a?.rowKey ?? null) === rowKey && (a?.date ?? null) === date;
}

/** The ⚠ beside a day over 8 h (shared with the day cards). */
export function OverMark() {
	return (
		<>
			<AlertTriangle
				className="ml-0.5 inline h-3 w-3 shrink-0 text-warning"
				aria-hidden="true"
			/>
			<span className="sr-only"> ({REVIEW_COPY.overDay})</span>
		</>
	);
}

interface CellProps {
	seconds: number;
	label: string;
	active: boolean;
	over?: boolean;
	strong?: boolean;
	onPress: () => void;
}

function Cell({ seconds, label, active, over, strong, onPress }: CellProps) {
	if (seconds <= 0) {
		return <span className="sr-only">{formatClock(0)}</span>;
	}
	return (
		<button
			type="button"
			aria-pressed={active}
			aria-label={`${label}: ${formatClock(seconds)}${over ? ` (${REVIEW_COPY.overDay})` : ""}`}
			onClick={onPress}
			className={cn(
				"inline-flex w-full items-center justify-end rounded-md px-1.5 py-1 tabular-nums transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				strong ? "font-semibold text-foreground" : "text-foreground",
				over && "text-warning-foreground",
				active && "bg-primary/10 ring-1 ring-primary/40",
			)}
		>
			{formatClock(seconds)}
			{over ? (
				<AlertTriangle
					className="ml-0.5 h-3 w-3 shrink-0 text-warning"
					aria-hidden="true"
				/>
			) : null}
		</button>
	);
}

export function DayProjectGrid({
	grid,
	filter,
	onFilter,
	now,
	userTimezone,
	className,
}: DayProjectGridProps) {
	const dayOptions = { now, userTimezone };
	const press = (rowKey: string | null, date: string | null) => {
		onFilter(sameFilter(filter, rowKey, date) ? null : { rowKey, date });
	};

	return (
		<div
			className={cn(
				"overflow-x-auto rounded-xl border border-border bg-card",
				className,
			)}
			data-testid="review-grid"
		>
			<table className="w-full min-w-max border-collapse text-sm">
				<caption className="sr-only">{REVIEW_COPY.gridCaption}</caption>
				<thead>
					<tr className="border-b border-border text-xs text-muted-foreground">
						<th
							scope="col"
							className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium"
						>
							<span className="sr-only">{REVIEW_COPY.project}</span>
						</th>
						{grid.days.map((date) => {
							const label = dayColumnLabel(date);
							return (
								<th
									key={date}
									scope="col"
									className="min-w-[3.75rem] px-1.5 py-2 text-right font-medium"
									title={dayFullName(date, dayOptions)}
								>
									<span className="block" aria-hidden="true">
										{label.weekday}
									</span>
									<span
										className="block text-[11px] font-normal text-muted-foreground/80"
										aria-hidden="true"
									>
										{label.day}
									</span>
									<span className="sr-only">
										{dayFullName(date, dayOptions)}
									</span>
								</th>
							);
						})}
						<th
							scope="col"
							className="px-3 py-2 text-right font-semibold text-foreground"
						>
							{REVIEW_COPY.total}
						</th>
					</tr>
				</thead>
				<tbody>
					{grid.rows.map((row) => (
						<tr
							key={row.key}
							data-row-key={row.key}
							className="border-b border-border/60 last:border-b-0"
						>
							<th
								scope="row"
								className={cn(
									"sticky left-0 z-10 max-w-[16rem] truncate bg-card px-3 py-1.5 text-left font-medium",
									row.merged
										? "italic text-muted-foreground"
										: "text-foreground",
								)}
								title={row.label}
							>
								{row.label}
							</th>
							{grid.days.map((date) => {
								const seconds = row.byDay[date] ?? 0;
								return (
									<td key={date} className="px-0.5 py-0.5 text-right">
										<Cell
											seconds={seconds}
											label={`${row.label}, ${dayFullName(date, dayOptions)}`}
											active={sameFilter(filter, row.key, date)}
											over={isOverDay(seconds)}
											onPress={() => press(row.key, date)}
										/>
									</td>
								);
							})}
							<td className="px-1 py-0.5 text-right">
								<Cell
									seconds={row.totalSeconds}
									label={`${row.label}, ${REVIEW_COPY.total.toLowerCase()}`}
									active={sameFilter(filter, row.key, null)}
									strong
									onPress={() => press(row.key, null)}
								/>
							</td>
						</tr>
					))}
				</tbody>
				<tfoot>
					<tr className="border-t border-border bg-muted/40">
						<th
							scope="row"
							className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-semibold text-foreground"
						>
							{REVIEW_COPY.total}
						</th>
						{grid.days.map((date) => {
							const seconds = grid.dayTotals[date] ?? 0;
							const over = isOverDay(seconds);
							return (
								<td
									key={date}
									className="px-0.5 py-1 text-right"
									data-over={over || undefined}
								>
									<Cell
										seconds={seconds}
										label={`${REVIEW_COPY.total}, ${dayFullName(date, dayOptions)}`}
										active={sameFilter(filter, null, date)}
										over={over}
										strong
										onPress={() => press(null, date)}
									/>
								</td>
							);
						})}
						<td className="px-3 py-1 text-right font-semibold tabular-nums text-foreground">
							<span data-testid="review-grid-total">
								{formatClock(grid.totalSeconds)}
							</span>
						</td>
					</tr>
				</tfoot>
			</table>
		</div>
	);
}
