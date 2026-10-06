// web/src/components/time/review/ReviewHeader.tsx
//
// The review screen's header (ux.md › Approvals › Review screen):
//
//   Maria Santos · Prodigitality Services Inc. Team · Sep 22 – 28, 2026 (Asia/Manila)
//   [Submitted · Waiting on …] Submitted Sep 29, 10:14 · 38:15 · 3 projects   [Return…] [Approve…]
//   Rules at submit: weekly · team owners & admins approve · manual time up to 7 days back
//
// The status pill uses the four status words and their sublabels
// (`sheetStatusView`). The third line is the rules line (L40) — on an
// agreement sheet "Rules from your agreement with Acme Corp · [View terms →]"
// (web only). On the member's own open or returned sheet a line under it says
// where the sheet goes (A1); both lines show when both apply.

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { isNativeApp } from "@/lib/platform";
import {
	formatPeriodRange,
	type SheetStatusView,
	type SheetTone,
	sheetScopeLabel,
} from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import type { TimesheetSummary } from "@/services/time.types";
import { REVIEW_COPY, type RulesView } from "./reviewModel";

const PILL: Record<SheetTone, string> = {
	neutral: "border-border bg-muted text-foreground",
	muted: "border-border bg-muted text-muted-foreground",
	warning: "border-warning/30 bg-warning/15 text-foreground",
	success: "border-success/30 bg-success/15 text-foreground",
};

export interface ReviewHeaderProps {
	sheet: Pick<
		TimesheetSummary,
		| "scope_kind"
		| "scope_label_snapshot"
		| "period_start"
		| "period_end"
		| "timezone"
	>;
	/** Whose sheet; omitted from the title when unknown. */
	personName: string | null;
	status: SheetStatusView;
	/** "Submitted Sep 29, 10:14", "38:15", "3 projects". */
	facts: readonly string[];
	rules: RulesView | null;
	/** The member's own open or returned sheet: "Goes to …" (A1), under the rules line. */
	goesTo?: string | null;
	/** The decision buttons, beside the facts (desktop). */
	actions?: ReactNode;
	native?: boolean;
	now?: Date;
	userTimezone?: string;
}

export function ReviewHeader({
	sheet,
	personName,
	status,
	facts,
	rules,
	goesTo,
	actions,
	native,
	now,
	userTimezone,
}: ReviewHeaderProps) {
	const isNative = native ?? isNativeApp();
	const scope = sheetScopeLabel(sheet.scope_kind, sheet.scope_label_snapshot, {
		native: isNative,
	});
	const period = formatPeriodRange(sheet.period_start, sheet.period_end, {
		spaced: true,
		year: "always",
		showTimezone: "always",
		timezone: sheet.timezone,
		now,
		userTimezone,
	});
	const statusText = status.sublabel
		? `${status.label} · ${status.sublabel}`
		: status.label;

	return (
		<header className="space-y-2">
			<h1 className="text-lg font-semibold leading-snug text-foreground sm:text-xl">
				{personName ? (
					<>
						<span>{personName}</span>
						<span className="font-normal text-muted-foreground"> · </span>
					</>
				) : null}
				<span className="break-words">{scope}</span>
				<span className="font-normal text-muted-foreground"> · </span>
				<span className="font-normal text-muted-foreground">{period}</span>
			</h1>
			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
					<span
						data-testid="review-status"
						data-tone={status.tone}
						className={cn(
							"inline-flex max-w-full items-center rounded-lg border px-2.5 py-0.5 text-xs font-semibold",
							PILL[status.tone],
						)}
						title={status.sublabels.join(" · ") || undefined}
					>
						<span className="min-w-0 break-words">{statusText}</span>
					</span>
					{facts.length > 0 ? (
						<span
							data-testid="review-facts"
							className="tabular-nums text-foreground"
						>
							{facts.join(" · ")}
						</span>
					) : null}
				</div>
				{actions ? (
					<div className="flex shrink-0 flex-wrap items-center gap-2">
						{actions}
					</div>
				) : null}
			</div>
			{rules ? (
				<p data-testid="review-rules" className="text-sm text-muted-foreground">
					{rules.text}
					{rules.engagementId && !isNative ? (
						<>
							<span aria-hidden="true"> · </span>
							<Link
								to="/engagements/$engagementId"
								params={{ engagementId: rules.engagementId }}
								className="font-semibold text-primary hover:underline"
							>
								{REVIEW_COPY.viewTerms}
							</Link>
						</>
					) : null}
				</p>
			) : null}
			{goesTo ? (
				<p
					data-testid="review-goes-to"
					className="text-sm text-muted-foreground"
				>
					{goesTo}
				</p>
			) : null}
		</header>
	);
}
