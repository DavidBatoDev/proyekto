// web/src/components/time/page/PolicySummaryCards.tsx
//
// Approver mode's policy cards (ux.md › The Time Page › Approver mode; P7).
// When nothing waits, a workspace admin who never logs sees one card per
// `workspace_time_admin[]` item, under "You're all caught up.":
//
//   ┌ Acme · Weekly · starts Monday · Asia/Manila · Approval required ─────┐
//   │                                              [Edit time policy]      │
//   └──────────────────────────────────────────────────────────────────────┘
//
// A workspace with workspace time off reads "Prodigitality · Workspace time
// off"; one whose plan has no timesheets adds the plan notice under it
// (`PlanLimitNotice`: the owner's upgrade link, everyone else's "ask the
// owner", the native wording and complimentary plans). Until the workspace's
// usage has loaded, the plain plan sentence stands in.

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building } from "lucide-react";
import {
	featureLimitInfo,
	PlanLimitNotice,
} from "@/components/billing/PlanLimitNotice";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useMyWorkspacesQuery } from "@/hooks/useWorkspaceQueries";
import { nativeSafe, timePlanCopy } from "@/lib/timeErrors";
import { capitalize, periodKindLabel, weekdayName } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import { timeQueries } from "@/queries/time";
import { browserTimeZone } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	WorkspaceTimeAdmin,
} from "@/services/time.types";
import { workspaceTrackingOn } from "./PolicyConfirmCard";

export const POLICY_SUMMARY_COPY = {
	edit: "Edit time policy",
	trackingOff: "Workspace time off",
	approvalRequired: "Approval required",
	approvalOff: "Approval off",
} as const;

/**
 * The card's line, as parts joined with " · ":
 * `["Acme", "Weekly", "starts Monday", "Asia/Manila", "Approval required"]`.
 * Week start only shows for weekly and two-weekly periods.
 */
export function policySummaryParts(
	name: string,
	policy: Pick<
		ResolvedTimePolicy,
		| "tracking_enabled"
		| "period_kind"
		| "week_start"
		| "timezone"
		| "approval_required"
	> & { plan?: ResolvedTimePolicy["plan"] | null },
): string[] {
	const parts = [name.trim() || "This workspace"];
	if (!workspaceTrackingOn(policy)) {
		parts.push(POLICY_SUMMARY_COPY.trackingOff);
		return parts;
	}
	parts.push(capitalize(periodKindLabel(policy.period_kind)));
	if (policy.period_kind === "weekly" || policy.period_kind === "biweekly") {
		const day = weekdayName(policy.week_start);
		if (day) parts.push(`starts ${day}`);
	}
	if (policy.timezone) parts.push(policy.timezone);
	parts.push(
		policy.approval_required
			? POLICY_SUMMARY_COPY.approvalRequired
			: POLICY_SUMMARY_COPY.approvalOff,
	);
	return parts;
}

export interface PolicySummaryCardsProps {
	/** `GET /time/me/overview` → `workspace_time_admin`. */
	admins: readonly WorkspaceTimeAdmin[] | null | undefined;
	className?: string;
}

export function PolicySummaryCards({
	admins,
	className,
}: PolicySummaryCardsProps) {
	const items = admins ?? [];
	if (items.length === 0) return null;
	return (
		<ul
			data-testid="policy-summary-cards"
			className={cn("space-y-2", className)}
		>
			{items.map((item) => (
				<li key={item.workspace_id}>
					<PolicySummaryCard admin={item} />
				</li>
			))}
		</ul>
	);
}

function PolicySummaryCard({ admin }: { admin: WorkspaceTimeAdmin }) {
	const policyQuery = useQuery(
		timeQueries.workspacePolicy(admin.workspace_id, {
			tz: browserTimeZone(),
		}),
	);
	const policy = policyQuery.data?.policy ?? null;
	const name = admin.name.trim() || "This workspace";
	const line = policy
		? nativeSafe(policySummaryParts(name, policy).join(" · "))
		: name;
	// `has_time_tracking` (the server's answer) decides; usage only shapes
	// the notice, and is read only for a workspace that lacks the feature.
	const lacksPlan = !admin.has_time_tracking;
	const entitlements = useEntitlements(lacksPlan ? admin.workspace_id : null);
	const myWorkspaces = useMyWorkspacesQuery();
	const role =
		myWorkspaces.data?.find((ws) => ws.id === admin.workspace_id)?.my_role ??
		null;
	const planInfo = lacksPlan
		? featureLimitInfo(entitlements, "time_tracking")
		: null;
	const planLine =
		lacksPlan && !planInfo
			? timePlanCopy("time_tracking", { workspaceName: admin.name })
			: null;

	return (
		<article
			data-testid="policy-summary-card"
			data-workspace={admin.workspace_id}
			className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center"
		>
			<div className="flex min-w-0 flex-1 items-start gap-3">
				<Building
					className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<div className="min-w-0">
					<p className="text-sm font-medium text-foreground">{line}</p>
					{!policy && policyQuery.isLoading ? (
						<span
							aria-hidden="true"
							className="mt-1.5 block h-3 w-56 max-w-full animate-pulse rounded bg-muted"
						/>
					) : null}
					{planInfo ? (
						<PlanLimitNotice
							variant="inline"
							info={{ ...planInfo, workspaceSlug: admin.slug }}
							workspace={{
								slug: admin.slug ?? "",
								my_role: role,
								name: admin.name,
							}}
							isComplimentary={entitlements.isComplimentary}
							className="mt-2"
						/>
					) : planLine ? (
						<p className="mt-0.5 text-xs text-muted-foreground">{planLine}</p>
					) : null}
				</div>
			</div>
			{admin.slug ? (
				<Link
					to="/w/$workspaceSlug/settings/time"
					params={{ workspaceSlug: admin.slug }}
					className="inline-flex h-8 shrink-0 items-center justify-center self-start whitespace-nowrap rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 max-sm:ml-7 sm:self-auto"
				>
					{POLICY_SUMMARY_COPY.edit}
				</Link>
			) : null}
		</article>
	);
}
