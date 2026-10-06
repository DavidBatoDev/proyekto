// web/src/components/time/review/MobileDayCards.tsx
//
// The review grid below 640 px (ux.md › Approvals › Mobile: "Stacked day cards
// with per-project lines"). One card per day that has time, each with its
// project lines and the day's total (⚠ past 8 h), then the period total.
// A project line or a day total filters the entries below, exactly as the
// grid's cells do on wider screens; pressing the active one again clears it.

import { formatClock } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import { OverMark } from "./DayProjectGrid";
import {
	dayFullName,
	isOverDay,
	REVIEW_COPY,
	type ReviewFilter,
	type ReviewGrid,
} from "./reviewModel";

export interface MobileDayCardsProps {
	grid: ReviewGrid;
	filter: ReviewFilter | null;
	onFilter: (filter: ReviewFilter | null) => void;
	now?: Date;
	userTimezone?: string;
	className?: string;
}

const LINE =
	"flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function MobileDayCards({
	grid,
	filter,
	onFilter,
	now,
	userTimezone,
	className,
}: MobileDayCardsProps) {
	const dayOptions = { now, userTimezone };
	const days = grid.days.filter((date) => (grid.dayTotals[date] ?? 0) > 0);
	const isActive = (rowKey: string | null, date: string | null) =>
		(filter?.rowKey ?? null) === rowKey && (filter?.date ?? null) === date;
	const press = (rowKey: string | null, date: string | null) =>
		onFilter(isActive(rowKey, date) ? null : { rowKey, date });

	return (
		<div className={cn("space-y-2", className)} data-testid="review-day-cards">
			<ul className="space-y-2">
				{days.map((date) => {
					const total = grid.dayTotals[date] ?? 0;
					const over = isOverDay(total);
					const name = dayFullName(date, dayOptions);
					return (
						<li
							key={date}
							className="rounded-xl border border-border bg-card p-2"
							data-day={date}
						>
							<button
								type="button"
								aria-pressed={isActive(null, date)}
								aria-label={`${name}: ${formatClock(total)}${over ? ` (${REVIEW_COPY.overDay})` : ""}`}
								onClick={() => press(null, date)}
								className={cn(
									LINE,
									"font-semibold text-foreground",
									isActive(null, date) && "bg-primary/10",
								)}
							>
								<span>{name}</span>
								<span
									className={cn(
										"inline-flex items-center tabular-nums",
										over && "text-warning-foreground",
									)}
								>
									{formatClock(total)}
									{over ? <OverMark /> : null}
								</span>
							</button>
							<ul className="mt-0.5">
								{grid.rows
									.filter((row) => (row.byDay[date] ?? 0) > 0)
									.map((row) => {
										const seconds = row.byDay[date] ?? 0;
										const active = isActive(row.key, date);
										return (
											<li key={row.key}>
												<button
													type="button"
													aria-pressed={active}
													aria-label={`${row.label}, ${name}: ${formatClock(seconds)}`}
													onClick={() => press(row.key, date)}
													className={cn(
														LINE,
														"text-foreground",
														active && "bg-primary/10",
													)}
												>
													<span
														className={cn(
															"min-w-0 truncate",
															row.merged && "italic text-muted-foreground",
														)}
													>
														{row.label}
													</span>
													<span className="shrink-0 tabular-nums">
														{formatClock(seconds)}
													</span>
												</button>
											</li>
										);
									})}
							</ul>
						</li>
					);
				})}
			</ul>
			<p className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-4 py-2 text-sm font-semibold text-foreground">
				<span>{REVIEW_COPY.total}</span>
				<span className="tabular-nums" data-testid="review-cards-total">
					{formatClock(grid.totalSeconds)}
				</span>
			</p>
		</div>
	);
}
