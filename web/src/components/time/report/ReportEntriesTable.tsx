import { ChevronLeft, ChevronRight } from "lucide-react";
import { isNativeApp } from "@/lib/platform";
import {
	canShowAmounts,
	type DateFormatOptions,
	formatClock,
	formatDurationText,
	formatInstantDay,
	formatInstantTime,
	formatMoneyLine,
} from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import type { TimeEntryView } from "@/services/time.types";
import {
	entryForLabel,
	entryPersonLabel,
	entryWorkLabels,
	isApprovedEntry,
	pageRangeLabel,
	REPORT_COPY,
	REPORT_ENTRIES_PAGE_SIZE,
	REPORT_STATUS_LABEL,
} from "./reportModel";

/**
 * A report's entries, read-only (ux.md › Reports). Rows follow the viewer's
 * grant (L21, L22): a masked person reads "Delivery team", a project the
 * viewer can't open reads "A project you can't open" with the work-item kind
 * only. An amount shows only on a row whose cost the viewer may see, never on
 * agreement time on native. Legacy markers stay in the entry detail (L56).
 *
 * `variant="client"` is the client's "Client hours" table: date, work and
 * approved hours, never a person, a note, a cost or a status.
 */
export interface ReportEntriesTableProps {
	entries: readonly TimeEntryView[];
	/** All matching entries (for the pager). */
	total: number;
	page: number;
	pageSize?: number;
	onPageChange?: (page: number) => void;
	loading?: boolean;
	/** The scope's timezone: dates and times are read in it. */
	timezone: string;
	variant?: "full" | "client";
	showPerson?: boolean;
	showFor?: boolean;
	showStatus?: boolean;
	/** Opens the entry (the host's detail modal or `/time?entry=`). */
	onOpenEntry?: (entry: TimeEntryView) => void;
	dateOptions?: DateFormatOptions;
	emptyText?: string;
	className?: string;
}

function entryAmount(entry: TimeEntryView, native: boolean): string | null {
	if (!canShowAmounts({ cost: entry.cost, kind: entry.context_kind, native })) {
		return null;
	}
	if (!isApprovedEntry(entry)) return null;
	const amount = entry.amount_snapshot;
	if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
	return formatMoneyLine(amount, entry.currency_snapshot);
}

const TH =
	"px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2 align-top";

export function ReportEntriesTable({
	entries,
	total,
	page,
	pageSize = REPORT_ENTRIES_PAGE_SIZE,
	onPageChange,
	loading = false,
	timezone,
	variant = "full",
	showPerson = true,
	showFor = true,
	showStatus = true,
	onOpenEntry,
	dateOptions,
	emptyText = REPORT_COPY.noTime,
	className,
}: ReportEntriesTableProps) {
	const native = isNativeApp();
	const client = variant === "client";
	const person = showPerson && !client;
	const forColumn = showFor && !client;
	const status = showStatus && !client;
	const amounts = client
		? new Map<string, string>()
		: new Map(
				entries
					.map((e) => [e.id, entryAmount(e, native)] as const)
					.filter(
						(pair): pair is readonly [string, string] => pair[1] !== null,
					),
			);
	const showAmount = amounts.size > 0;
	const pages = Math.max(1, Math.ceil(total / pageSize));

	if (!loading && entries.length === 0) {
		return (
			<p
				className={cn(
					"rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground",
					className,
				)}
			>
				{emptyText}
			</p>
		);
	}

	return (
		<div className={cn("space-y-2", className)}>
			<div className="overflow-x-auto rounded-xl border border-border bg-card">
				<table className="w-full min-w-[20rem] text-sm">
					<thead>
						<tr className="border-b border-border">
							<th scope="col" className={TH}>
								Date
							</th>
							{person ? (
								<th scope="col" className={TH}>
									Person
								</th>
							) : null}
							<th scope="col" className={TH}>
								Work
							</th>
							{forColumn ? (
								<th scope="col" className={cn(TH, "hidden md:table-cell")}>
									For
								</th>
							) : null}
							{client ? null : (
								<th scope="col" className={cn(TH, "hidden sm:table-cell")}>
									Time
								</th>
							)}
							{client ? null : (
								<th scope="col" className={cn(TH, "text-right")}>
									Duration
								</th>
							)}
							<th scope="col" className={cn(TH, "text-right")}>
								{REPORT_COPY.approved}
							</th>
							{showAmount ? (
								<th scope="col" className={cn(TH, "text-right")}>
									{REPORT_COPY.cost}
								</th>
							) : null}
							{status ? (
								<th scope="col" className={cn(TH, "hidden sm:table-cell")}>
									{REPORT_COPY.timesheet}
								</th>
							) : null}
						</tr>
					</thead>
					<tbody className={cn(loading ? "opacity-60" : undefined)}>
						{entries.map((entry) => {
							const work = entryWorkLabels(entry);
							const forLabel = entryForLabel(entry, { native });
							const approved = isApprovedEntry(entry);
							const running = entry.ended_at === null;
							const workText = client
								? `${work.project} · ${work.work}`
								: work.work;
							return (
								<tr
									key={entry.id}
									className="border-b border-border last:border-b-0"
								>
									<td className={cn(TD, "whitespace-nowrap text-foreground")}>
										{formatInstantDay(entry.started_at, timezone, {
											...dateOptions,
											weekday: true,
										})}
									</td>
									{person ? (
										<td
											className={cn(
												TD,
												"max-w-[10rem] truncate",
												entry.identity === "masked"
													? "text-muted-foreground"
													: "text-foreground",
											)}
										>
											{entryPersonLabel(entry)}
										</td>
									) : null}
									<td className={cn(TD, "min-w-0 max-w-[18rem]")}>
										{onOpenEntry ? (
											<button
												type="button"
												onClick={() => onOpenEntry(entry)}
												title={workText}
												className="block max-w-full truncate text-left font-medium text-foreground hover:text-primary hover:underline"
											>
												{workText}
											</button>
										) : (
											<span
												className="block truncate font-medium text-foreground"
												title={workText}
											>
												{workText}
											</span>
										)}
										{client ? null : (
											<span
												className={cn(
													"block truncate text-xs",
													work.hidden
														? "italic text-muted-foreground"
														: "text-muted-foreground",
												)}
												title={work.project}
											>
												{work.project}
											</span>
										)}
									</td>
									{forColumn ? (
										<td
											className={cn(
												TD,
												"hidden max-w-[12rem] truncate text-muted-foreground md:table-cell",
											)}
											title={forLabel.title}
										>
											{forLabel.text}
										</td>
									) : null}
									{client ? null : (
										<td
											className={cn(
												TD,
												"hidden whitespace-nowrap tabular-nums text-muted-foreground sm:table-cell",
											)}
										>
											{formatInstantTime(entry.started_at, timezone)}–
											{running
												? ""
												: formatInstantTime(entry.ended_at, timezone)}
										</td>
									)}
									{client ? null : (
										<td
											className={cn(
												TD,
												"whitespace-nowrap text-right tabular-nums text-foreground",
											)}
										>
											{running ? (
												<span className="text-xs font-semibold text-primary">
													{REPORT_COPY.running}
												</span>
											) : (
												<span
													title={formatDurationText(entry.duration_seconds)}
												>
													{formatClock(entry.duration_seconds)}
												</span>
											)}
										</td>
									)}
									<td
										className={cn(
											TD,
											"whitespace-nowrap text-right tabular-nums",
											approved ? "text-foreground" : "text-muted-foreground",
										)}
									>
										{approved ? formatClock(entry.payable_seconds) : "—"}
									</td>
									{showAmount ? (
										<td
											className={cn(
												TD,
												"whitespace-nowrap text-right tabular-nums text-foreground",
											)}
										>
											{amounts.get(entry.id) ?? "—"}
										</td>
									) : null}
									{status ? (
										<td
											className={cn(
												TD,
												"hidden whitespace-nowrap text-muted-foreground sm:table-cell",
											)}
										>
											{entry.timesheet
												? REPORT_STATUS_LABEL[entry.timesheet.status]
												: "—"}
										</td>
									) : null}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			{total > pageSize && onPageChange ? (
				<div className="flex items-center justify-end gap-2 px-1 text-xs text-muted-foreground">
					<span className="tabular-nums">
						{pageRangeLabel(page, pageSize, total)}
					</span>
					<button
						type="button"
						aria-label={REPORT_COPY.previousPage}
						disabled={page <= 1 || loading}
						onClick={() => onPageChange(page - 1)}
						className="rounded-md border border-border p-1 text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
					>
						<ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
					</button>
					<button
						type="button"
						aria-label={REPORT_COPY.nextPage}
						disabled={page >= pages || loading}
						onClick={() => onPageChange(page + 1)}
						className="rounded-md border border-border p-1 text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
					>
						<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
					</button>
				</div>
			) : null}
		</div>
	);
}
