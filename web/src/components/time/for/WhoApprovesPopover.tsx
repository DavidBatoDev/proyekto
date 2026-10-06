// web/src/components/time/for/WhoApprovesPopover.tsx
//
// "Who approves this time", opened from any For chip (ux.md › For Chip):
//
//   Who approves this time
//   Goes to: Prodigitality Services Inc. Team's owners and admins
//   Timesheet: weekly · starts Monday · Asia/Manila
//   Rules: set by Prodigitality Services Inc. Team (team override)
//   Manual time up to 7 days back · No rounding
//
// Each line carries its source (default | workspace | team | contract |
// member). An agreement reads "Set by your agreement with Acme Corp" and links
// "View terms →" on the web only (A8 `engagement_id`); native never links to
// /engagements.

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import type { RefObject } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { isNativeApp } from "@/lib/platform";
import { timeQueries } from "@/queries/time";
import type { ResolvedTimePolicy } from "@/services/time.types";
import { VIEW_TERMS_LABEL, whoApprovesView } from "./forCopy";
import { type ForChipOption, toForRequest } from "./forOptions";

export interface WhoApprovesContentProps {
	option: ForChipOption;
	policy: ResolvedTimePolicy | null | undefined;
	loading?: boolean;
	projectWorkspaceName?: string | null;
	personalReason?: "plan" | "no_governed_option" | null;
}

/** The popover's body; also usable inline (a sheet's rules, a settings row). */
export function WhoApprovesContent({
	option,
	policy,
	loading = false,
	projectWorkspaceName,
	personalReason,
}: WhoApprovesContentProps) {
	const native = isNativeApp();
	const view = whoApprovesView(option, policy, {
		native,
		projectWorkspaceName,
		personalReason,
	});
	return (
		<div className="space-y-2 p-3 text-xs text-popover-foreground">
			<p className="text-sm font-semibold text-foreground">{view.title}</p>
			<ul className="space-y-1.5">
				{view.lines.map((line) => (
					<li
						key={line.key}
						className="flex items-start justify-between gap-3"
						data-line={line.key}
					>
						<span className="min-w-0 leading-relaxed">{line.text}</span>
						{line.sourceLabel ? (
							<span
								className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
								title={line.source ? `Source: ${line.sourceLabel}` : undefined}
							>
								{line.sourceLabel}
							</span>
						) : null}
					</li>
				))}
			</ul>
			{loading ? (
				<p className="inline-flex items-center gap-1.5 text-muted-foreground">
					<Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
					<span className="sr-only">Loading</span>
				</p>
			) : null}
			{view.viewTermsEngagementId && !native ? (
				<Link
					to="/engagements/$engagementId"
					params={{ engagementId: view.viewTermsEngagementId }}
					className="inline-block font-semibold text-primary hover:underline"
				>
					{VIEW_TERMS_LABEL}
				</Link>
			) : null}
		</div>
	);
}

export interface WhoApprovesPopoverProps {
	anchorRef: RefObject<HTMLElement | null>;
	open: boolean;
	onClose: () => void;
	/** The project the time is on (the policy is per project and option). */
	projectId: string | null | undefined;
	option: ForChipOption;
	projectWorkspaceName?: string | null;
	personalReason?: "plan" | "no_governed_option" | null;
	/** Raise above AppDialog (1200) when opened from inside one. */
	zIndex?: number;
}

export function WhoApprovesPopover({
	anchorRef,
	open,
	onClose,
	projectId,
	option,
	projectWorkspaceName,
	personalReason,
	zIndex,
}: WhoApprovesPopoverProps) {
	const governed = option.kind !== "personal" && Boolean(projectId);
	// A miss (an entry's old choice that is no longer an option) is a 404:
	// the popover still shows who the time went to.
	const policyQuery = useQuery({
		...timeQueries.projectPolicy(
			projectId,
			governed ? toForRequest(option) : null,
		),
		enabled: open && governed,
	});
	return (
		<AnchoredPopover
			anchorRef={anchorRef}
			open={open}
			onClose={onClose}
			width={300}
			maxHeight={320}
			zIndex={zIndex}
			ariaLabel="Who approves this time"
		>
			<WhoApprovesContent
				option={option}
				policy={policyQuery.data ?? null}
				loading={governed && policyQuery.isLoading}
				projectWorkspaceName={projectWorkspaceName}
				personalReason={personalReason}
			/>
		</AnchoredPopover>
	);
}
