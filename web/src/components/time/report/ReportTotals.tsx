import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { formatClock, formatDurationText, moneyLines } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import type { TimesheetStatus } from "@/services/time.types";
import {
	REPORT_COPY,
	REPORT_STATUS_LABEL,
	type ReportFigures,
} from "./reportModel";

/**
 * The report's totals (ux.md › Reports › Totals, L11, CHANGE-5). Approved and
 * Not yet approved sit side by side and are never added together; there is
 * no "total" tile, and cost covers approved time only. Billable shows when it
 * is known. Cost shows only when the caller allows it (`showAmounts`: cost
 * the viewer may see, and never agreement time on native).
 */
export interface ReportTotalsProps {
	figures: ReportFigures | null;
	loading?: boolean;
	/** False in the client's view, which only holds approved time. */
	showNotApproved?: boolean;
	/** Not yet approved is still loading (else an unknown value reads "—"). */
	notApprovedPending?: boolean;
	/**
	 * The read behind Not yet approved failed: the tile says why and offers
	 * Try again instead of an unexplained "—" (a refusal never looks like no
	 * data).
	 */
	notApprovedError?: {
		message: string;
		onRetry: () => void;
		/** The retry is in flight (the button waits). */
		retrying?: boolean;
	} | null;
	showAmounts?: boolean;
	/** Distinct timesheets per status in the range (D69). */
	sheetCounts?: Partial<Record<TimesheetStatus, number>> | null;
	className?: string;
}

const STATUS_ORDER: TimesheetStatus[] = [
	"open",
	"submitted",
	"returned",
	"approved",
];

/** "Timesheets: 2 open · 1 submitted · 4 approved" (zero counts left out). */
export function sheetCountsLine(
	counts: Partial<Record<TimesheetStatus, number>> | null | undefined,
): string | null {
	if (!counts) return null;
	const parts = STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0).map(
		(s) => `${counts[s]} ${REPORT_STATUS_LABEL[s].toLowerCase()}`,
	);
	return parts.length > 0
		? `${REPORT_COPY.timesheets}: ${parts.join(" · ")}`
		: null;
}

function Tile({
	label,
	children,
	hint,
	hintRole,
	tone = "default",
}: {
	label: string;
	children: ReactNode;
	hint?: string;
	hintRole?: "alert";
	tone?: "default" | "muted";
}) {
	return (
		<div
			role="group"
			aria-label={label}
			className="min-w-0 rounded-xl border border-border bg-card px-4 py-3"
		>
			<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
				{label}
			</p>
			<div
				className={cn(
					"mt-1 text-xl font-semibold tabular-nums",
					tone === "muted" ? "text-muted-foreground" : "text-foreground",
				)}
			>
				{children}
			</div>
			{hint ? (
				<p
					role={hintRole}
					className="mt-1 text-xs leading-snug text-muted-foreground"
				>
					{hint}
				</p>
			) : null}
		</div>
	);
}

function Skeleton() {
	return (
		<span
			aria-hidden="true"
			className="inline-block h-6 w-16 animate-pulse rounded bg-muted"
		/>
	);
}

function Duration({ seconds }: { seconds: number }) {
	return (
		<span title={formatDurationText(seconds)}>{formatClock(seconds)}</span>
	);
}

export function ReportTotals({
	figures,
	loading = false,
	showNotApproved = true,
	notApprovedPending = false,
	notApprovedError = null,
	showAmounts = false,
	sheetCounts,
	className,
}: ReportTotalsProps) {
	const f = loading ? null : figures;
	const lines = showAmounts && f?.amounts ? moneyLines(f.amounts) : [];
	const counts = f ? sheetCountsLine(sheetCounts) : null;
	const notApprovedFailed =
		Boolean(f) && f?.notApprovedSeconds === null && Boolean(notApprovedError);

	return (
		<div className={cn("space-y-2", className)}>
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				<Tile label={REPORT_COPY.approved}>
					{f ? <Duration seconds={f.approvedSeconds} /> : <Skeleton />}
				</Tile>
				{showNotApproved ? (
					<Tile
						label={REPORT_COPY.notApproved}
						hint={
							notApprovedFailed && notApprovedError
								? notApprovedError.message
								: REPORT_COPY.notApprovedHint
						}
						hintRole={notApprovedFailed ? "alert" : undefined}
						tone="muted"
					>
						{f && f.notApprovedSeconds !== null ? (
							<Duration seconds={f.notApprovedSeconds} />
						) : notApprovedFailed && notApprovedError ? (
							<button
								type="button"
								onClick={notApprovedError.onRetry}
								disabled={notApprovedError.retrying}
								className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
							>
								<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
								{REPORT_COPY.retry}
							</button>
						) : !f || notApprovedPending ? (
							<Skeleton />
						) : (
							"—"
						)}
					</Tile>
				) : null}
				{f && f.billableSeconds !== null ? (
					<Tile label={REPORT_COPY.billable}>
						<Duration seconds={f.billableSeconds} />
					</Tile>
				) : null}
				{lines.length > 0 ? (
					<Tile label={REPORT_COPY.cost}>
						<div className="space-y-0.5 text-base">
							{lines.map((line) => (
								<p key={line}>{line}</p>
							))}
						</div>
					</Tile>
				) : null}
			</div>
			{counts ? (
				<p className="px-1 text-xs text-muted-foreground">{counts}</p>
			) : null}
		</div>
	);
}
