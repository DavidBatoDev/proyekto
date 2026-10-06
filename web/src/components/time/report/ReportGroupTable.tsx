import {
	type DateFormatOptions,
	formatClock,
	formatDurationText,
	moneyLines,
} from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import type { ReportGroupBy } from "@/services/time.types";
import {
	groupRowLabel,
	REPORT_COPY,
	REPORT_GROUP_HEADER,
	type ReportRow,
} from "./reportModel";

/**
 * The summary as a table: one row per person, project, task, day or week (A5:
 * a week row's key is its first day in the scope's timezone and week start).
 * Approved and Not yet approved are separate columns and no column adds them.
 * The Cost column appears only when some row may show an amount.
 */
export interface ReportGroupTableProps {
	groupBy: ReportGroupBy;
	rows: readonly ReportRow[];
	loading?: boolean;
	/** False in the client's view. */
	showNotApproved?: boolean;
	/** Not yet approved is still loading (else an unknown value reads "—"). */
	notApprovedPending?: boolean;
	/** Per row: may its amount show (cost visible, native rule)? */
	amountsFor?: (row: ReportRow) => boolean;
	/** Year rule for day and week labels. */
	dateOptions?: DateFormatOptions;
	/** Makes rows clickable where `canSelect` says so (a person row filters to them). */
	onSelectRow?: (row: ReportRow) => void;
	canSelect?: (row: ReportRow) => boolean;
	emptyText?: string;
	className?: string;
}

function Seconds({
	value,
	pending = false,
}: {
	value: number | null;
	pending?: boolean;
}) {
	if (value === null && !pending) return <span>—</span>;
	if (value === null) {
		return (
			<span
				aria-hidden="true"
				className="inline-block h-3 w-10 animate-pulse rounded bg-muted"
			/>
		);
	}
	return <span title={formatDurationText(value)}>{formatClock(value)}</span>;
}

export function ReportGroupTable({
	groupBy,
	rows,
	loading = false,
	showNotApproved = true,
	notApprovedPending = false,
	amountsFor,
	dateOptions,
	onSelectRow,
	canSelect,
	emptyText = REPORT_COPY.noTime,
	className,
}: ReportGroupTableProps) {
	const showCost = rows.some(
		(row) => row.amounts !== null && (amountsFor ? amountsFor(row) : false),
	);
	const header = REPORT_GROUP_HEADER[groupBy];

	if (!loading && rows.length === 0) {
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
		<div
			className={cn(
				"overflow-x-auto rounded-xl border border-border bg-card",
				className,
			)}
		>
			<table className="w-full min-w-[22rem] text-sm">
				<thead>
					<tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						<th scope="col" className="px-4 py-2">
							{header}
						</th>
						<th scope="col" className="px-4 py-2 text-right">
							{REPORT_COPY.approved}
						</th>
						{showNotApproved ? (
							<th scope="col" className="px-4 py-2 text-right">
								{REPORT_COPY.notApproved}
							</th>
						) : null}
						{showCost ? (
							<th scope="col" className="px-4 py-2 text-right">
								{REPORT_COPY.cost}
							</th>
						) : null}
					</tr>
				</thead>
				<tbody>
					{loading
						? [0, 1, 2].map((i) => (
								<tr key={`skeleton-${i}`} className="border-b border-border">
									<td className="px-4 py-2.5" colSpan={4}>
										<span
											aria-hidden="true"
											className="block h-3 w-1/2 animate-pulse rounded bg-muted"
										/>
									</td>
								</tr>
							))
						: rows.map((row) => {
								const label = groupRowLabel(groupBy, row, dateOptions);
								const selectable =
									Boolean(onSelectRow) && (canSelect ? canSelect(row) : true);
								const lines =
									showCost && row.amounts && amountsFor?.(row)
										? moneyLines(row.amounts)
										: [];
								return (
									<tr
										key={row.key}
										className="border-b border-border last:border-b-0"
									>
										<th
											scope="row"
											className="max-w-[16rem] truncate px-4 py-2 text-left font-medium text-foreground"
											title={label}
										>
											{selectable ? (
												<button
													type="button"
													onClick={() => onSelectRow?.(row)}
													className="max-w-full truncate text-left hover:text-primary hover:underline"
												>
													{label}
												</button>
											) : (
												label
											)}
										</th>
										<td className="px-4 py-2 text-right tabular-nums text-foreground">
											<Seconds value={row.approvedSeconds} />
										</td>
										{showNotApproved ? (
											<td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
												<Seconds
													value={row.notApprovedSeconds}
													pending={notApprovedPending}
												/>
											</td>
										) : null}
										{showCost ? (
											<td className="px-4 py-2 text-right tabular-nums text-foreground">
												{lines.length > 0
													? lines.map((line) => <div key={line}>{line}</div>)
													: "—"}
											</td>
										) : null}
									</tr>
								);
							})}
				</tbody>
			</table>
		</div>
	);
}
