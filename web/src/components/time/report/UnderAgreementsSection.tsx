import { formatClock, formatDurationText } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import { REPORT_COPY } from "./reportModel";

/**
 * Team › Time's hours-only "Under agreements" line (ux.md › Reports, L35,
 * E34): time logged under assignments whose `team_id` is this team, on the
 * team's projects. That time is approved under its agreement (the hirer, or
 * confirmed for a client agreement), not by the team, so the team report
 * shows logged hours only: no person (the API sends a total, so every viewer
 * reads "Delivery team"), no cost and no approval split. Nothing renders at 0.
 */
export interface UnderAgreementsSectionProps {
	/** `ReportSummary.under_agreements_seconds` (team scope only). */
	seconds: number | null | undefined;
	className?: string;
}

export function UnderAgreementsSection({
	seconds,
	className,
}: UnderAgreementsSectionProps) {
	if (
		typeof seconds !== "number" ||
		!Number.isFinite(seconds) ||
		seconds <= 0
	) {
		return null;
	}
	return (
		<section
			aria-label={REPORT_COPY.underAgreements}
			className={cn(
				"overflow-hidden rounded-xl border border-border bg-card",
				className,
			)}
		>
			<header className="border-b border-border bg-muted/40 px-4 py-2.5">
				<h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
					{REPORT_COPY.underAgreements}
				</h3>
				<p className="mt-0.5 text-xs text-muted-foreground">
					{REPORT_COPY.underAgreementsHint}
				</p>
			</header>
			<div className="flex items-baseline gap-4 px-4 py-2 text-sm">
				<span className="min-w-0 flex-1 truncate text-muted-foreground">
					{REPORT_COPY.deliveryTeam}
				</span>
				<span
					className="tabular-nums text-foreground"
					title={formatDurationText(seconds)}
				>
					{formatClock(seconds)}
				</span>
				<span className="text-xs text-muted-foreground">
					{REPORT_COPY.logged} ({REPORT_COPY.hoursOnly})
				</span>
			</div>
		</section>
	);
}
