import { isNativeApp } from "@/lib/platform";
import {
	canShowAmounts,
	formatClock,
	formatDurationText,
	joinMoneyLines,
	moneyLines,
} from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import { REPORT_COPY, type ReportSection, sectionHeading } from "./reportModel";

/**
 * Project › Time · Everyone (ux.md › Reports › Project › Time page): one
 * section per governed context on the project, each with its people.
 *
 * ```
 * PRODIGITALITY SERVICES… · team   Approved 120:30 · Not yet approved 14:00 · PHP 54,225.00
 *   Maria Santos   62:15   …
 * DELIVERY TEAM · agreement with Acme Corp            Approved 38:00   (hours only)
 * ```
 *
 * Assignment people are named only to provider-side viewers (the server masks
 * the rest as "Delivery team"). Cost shows only where the viewer may see it,
 * and never on agreement time on native; a section without cost reads
 * "(hours only)". Approved and Not yet approved are never added together.
 */
export interface ReportSectionsProps {
	sections: readonly ReportSection[];
	loading?: boolean;
	/** The walk stopped at the 10,000-entry cap. */
	capped?: boolean;
	emptyText?: string;
	className?: string;
}

function Clock({ seconds }: { seconds: number }) {
	return (
		<span className="tabular-nums" title={formatDurationText(seconds)}>
			{formatClock(seconds)}
		</span>
	);
}

export function ReportSections({
	sections,
	loading = false,
	capped = false,
	emptyText = REPORT_COPY.noTime,
	className,
}: ReportSectionsProps) {
	const native = isNativeApp();

	if (loading) {
		return (
			<div className={cn("space-y-2", className)} aria-busy="true">
				{[0, 1].map((i) => (
					<div
						key={i}
						className="h-16 animate-pulse rounded-xl border border-border bg-muted/50"
					/>
				))}
			</div>
		);
	}

	if (sections.length === 0) {
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
		<div className={cn("space-y-3", className)}>
			{sections.map((section) => {
				const heading = sectionHeading(section);
				const amountsAllowed =
					section.costVisible &&
					canShowAmounts({ cost: "visible", kind: section.kind, native });
				const sectionLines =
					amountsAllowed && section.amounts ? moneyLines(section.amounts) : [];
				return (
					<section
						key={section.key}
						aria-label={heading.title ?? heading.text}
						className="overflow-hidden rounded-xl border border-border bg-card"
					>
						<header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border bg-muted/40 px-4 py-2.5">
							<h3
								className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-foreground"
								title={heading.title}
							>
								{heading.text}
							</h3>
							<p className="text-xs text-muted-foreground">
								<span>
									{REPORT_COPY.approved}{" "}
									<span className="font-semibold text-foreground">
										<Clock seconds={section.approvedSeconds} />
									</span>
								</span>
								{section.notApprovedSeconds > 0 ? (
									<span>
										{" · "}
										{REPORT_COPY.notApproved}{" "}
										<Clock seconds={section.notApprovedSeconds} />
									</span>
								) : null}
								{sectionLines.length > 0 ? (
									<span className="text-foreground">
										{" · "}
										{joinMoneyLines(sectionLines)}
									</span>
								) : (
									<span> ({REPORT_COPY.hoursOnly})</span>
								)}
							</p>
						</header>
						<ul className="divide-y divide-border">
							{section.people.map((person) => {
								const lines =
									amountsAllowed && person.amounts
										? moneyLines(person.amounts)
										: [];
								return (
									<li
										key={person.key}
										className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-2 text-sm"
									>
										<span
											className={cn(
												"min-w-0 flex-1 truncate",
												person.masked
													? "text-muted-foreground"
													: "font-medium text-foreground",
											)}
										>
											{person.label}
										</span>
										<span className="text-foreground">
											<span className="sr-only">{REPORT_COPY.approved} </span>
											<Clock seconds={person.approvedSeconds} />
										</span>
										{person.notApprovedSeconds > 0 ? (
											<span className="text-xs text-muted-foreground">
												{REPORT_COPY.notApproved}{" "}
												<Clock seconds={person.notApprovedSeconds} />
											</span>
										) : null}
										{lines.length > 0 ? (
											<span className="text-xs tabular-nums text-muted-foreground">
												{joinMoneyLines(lines)}
											</span>
										) : null}
									</li>
								);
							})}
						</ul>
					</section>
				);
			})}
			{capped ? (
				<p className="px-1 text-xs text-muted-foreground">
					{REPORT_COPY.capped}
				</p>
			) : null}
		</div>
	);
}
