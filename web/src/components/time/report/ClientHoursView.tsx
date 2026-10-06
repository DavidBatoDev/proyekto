import { RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { httpStatusOf } from "@/lib/apiErrors";
import { timeErrorCopy } from "@/lib/timeErrors";
import {
	contextSectionLabel,
	deviceTimeZone,
	formatClock,
} from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import { ReportEntriesTable } from "./ReportEntriesTable";
import { ReportGroupTable } from "./ReportGroupTable";
import {
	entriesPageQuery,
	REPORT_COPY,
	REPORT_ENTRIES_PAGE_SIZE,
	type ReportRange,
	reportFigures,
	reportFilterQuery,
	summaryQuery,
} from "./reportModel";
import { useReportEntriesPage, useReportSummary } from "./useTimeReport";

/**
 * Project › Time · Client hours (ux.md › Reports, L22, CHANGE-7): the client
 * party's approved hours per agreement, at the engagement's
 * `client_hours_detail_level`.
 *
 * - `summary`: hours by week (A5 `group_by=week`).
 * - `detailed`: date, work and approved hours per entry.
 *
 * Never a person, a note, a cost or a rate: rows are always the delivery
 * team's, whatever the server could name. The server serves only approved
 * time on this scope, so there is no Not yet approved column. A `detailed`
 * read the server refuses (the level is lower than the host thought) falls
 * back to the weekly summary.
 */
export interface ClientHoursAgreement {
	engagementId: string;
	/** The counterparty ("Acme Corp"). */
	label: string;
	level: "summary" | "detailed";
}

export interface ClientHoursViewProps {
	agreements: readonly ClientHoursAgreement[];
	range: ReportRange;
	/** The agreements' timezone when the host knows it (dates are read in it). */
	timezone?: string | null;
	className?: string;
}

function AgreementHours({
	agreement,
	range,
	timezone,
}: {
	agreement: ClientHoursAgreement;
	range: ReportRange;
	timezone: string;
}) {
	const scope = { kind: "engagement" as const, id: agreement.engagementId };
	const filters = reportFilterQuery(scope, {}, range);
	const summary = useReportSummary(summaryQuery(filters, "week"));
	const [page, setPage] = useState(1);
	const wantsDetail = agreement.level === "detailed";
	const entries = useReportEntriesPage(
		entriesPageQuery(filters, page, REPORT_ENTRIES_PAGE_SIZE),
		wantsDetail,
	);
	const detailRefused = wantsDetail && httpStatusOf(entries.error) === 404;
	const detailed = wantsDetail && !detailRefused;
	const tz = summary.data?.timezone ?? timezone;
	const heading = contextSectionLabel("engagement", agreement.label);
	const figures = summary.data
		? reportFigures(summary.data, null, "approved_only")
		: null;

	let body: ReactNode;
	if (summary.isError) {
		const copy = timeErrorCopy(summary.error, {
			subject: "scope",
			operation: "read",
		});
		body = (
			<TimeReasonCard
				variant="inline"
				tone={copy.notFound ? "not-found" : "danger"}
				title={copy.message}
				action={
					copy.notFound ? null : (
						<button
							type="button"
							onClick={() => void summary.refetch()}
							className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
						>
							<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
							{REPORT_COPY.retry}
						</button>
					)
				}
			/>
		);
	} else if (detailed) {
		body = (
			<ReportEntriesTable
				variant="client"
				entries={entries.data?.items ?? []}
				total={entries.data?.total ?? 0}
				page={page}
				onPageChange={setPage}
				loading={entries.isPending || entries.isPlaceholderData}
				timezone={tz}
				emptyText={REPORT_COPY.noApprovedTime}
			/>
		);
	} else {
		body = (
			<ReportGroupTable
				groupBy="week"
				rows={figures?.rows ?? []}
				loading={summary.isPending}
				showNotApproved={false}
				emptyText={REPORT_COPY.noApprovedTime}
			/>
		);
	}

	return (
		<section
			aria-label={heading}
			className="space-y-2 rounded-xl border border-border bg-card p-3"
		>
			<header className="flex flex-wrap items-baseline justify-between gap-2 px-1">
				<h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
					{heading}
				</h3>
				{figures ? (
					<p className="text-xs text-muted-foreground">
						{REPORT_COPY.approved}{" "}
						<span className="font-semibold tabular-nums text-foreground">
							{formatClock(figures.totals.approvedSeconds)}
						</span>
					</p>
				) : null}
			</header>
			{body}
		</section>
	);
}

export function ClientHoursView({
	agreements,
	range,
	timezone,
	className,
}: ClientHoursViewProps) {
	const tz = timezone || deviceTimeZone();
	if (agreements.length === 0) {
		return (
			<p
				className={cn(
					"rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground",
					className,
				)}
			>
				{REPORT_COPY.noApprovedTime}
			</p>
		);
	}
	return (
		<div className={cn("space-y-3", className)}>
			{agreements.map((agreement) => (
				<AgreementHours
					key={agreement.engagementId}
					agreement={agreement}
					range={range}
					timezone={tz}
				/>
			))}
		</div>
	);
}
