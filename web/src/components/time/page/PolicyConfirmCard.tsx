// web/src/components/time/page/PolicyConfirmCard.tsx
//
// The one-time policy confirm card (ux.md › The Time Page › One-time cards;
// L28, CHANGE-11). Workspace owners and admins see it, above the timer bar,
// for each `workspace_time_admin[]` item with `policy_unconfirmed: true`:
//
//   Tracking on:  "Acme tracks time weekly from Monday in Asia/Manila.
//                  [Looks right] [Change]"
//   Tracking off: "Prodigitality Workspace has workspace time off. People who
//                  aren't on a team can only track time for themselves.
//                  [Looks right] [Change]"
//
// It is a confirmation, not an opt-in. **Looks right** sends
// `PUT /time/policies/workspaces/:id` with the values shown (`confirm: true`
// stamps the row as confirmed), taking the timezone from the admin's browser.
// **Change** opens `/w/<slug>/settings/time`. Saving there confirms too.
//
// Workspaces whose plan has no timesheets (`has_time_tracking: false`) get no
// card: their people log "Just me" and the policy has nothing to confirm; the
// owner gets the plan notice instead (`TimePlanBanner`).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarClock, Loader2 } from "lucide-react";
import { useState } from "react";
import { nativeSafe, timeErrorMessage } from "@/lib/timeErrors";
import { weekdayName } from "@/lib/timeFormat";
import { isValidTimezone } from "@/lib/timePeriods";
import { cn } from "@/lib/utils";
import { invalidateTime, timeKeys, timeQueries } from "@/queries/time";
import { browserTimeZone, timeService } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	WorkspaceTimeAdmin,
	WorkspaceTimePolicyInput,
} from "@/services/time.types";

export const POLICY_CONFIRM_COPY = {
	looksRight: "Looks right",
	change: "Change",
	trackingOff: (name: string) =>
		`${name} has workspace time off. People who aren't on a team can only track time for themselves.`,
} as const;

type PolicyFacts = Pick<
	ResolvedTimePolicy,
	"tracking_enabled" | "period_kind" | "week_start" | "timezone"
> & { plan?: ResolvedTimePolicy["plan"] | null };

/** Workspace time is on: the policy switch is on and the plan has timesheets. */
export function workspaceTrackingOn(policy: PolicyFacts): boolean {
	return policy.tracking_enabled && policy.plan?.time_tracking !== false;
}

/** "weekly from Monday", "every two weeks from Monday", "twice a month (1–15, 16–end)", "monthly". */
export function policyPeriodPhrase(
	policy: Pick<ResolvedTimePolicy, "period_kind" | "week_start">,
): string {
	const day = weekdayName(policy.week_start) || "Monday";
	switch (policy.period_kind) {
		case "biweekly":
			return `every two weeks from ${day}`;
		case "semi_monthly":
			return "twice a month (1–15, 16–end)";
		case "monthly":
			return "monthly";
		default:
			return `weekly from ${day}`;
	}
}

/**
 * The timezone the card names and saves: the admin's browser (CHANGE-11:
 * the editing admin's browser comes first), else the policy's own.
 */
export function confirmTimeZone(
	policy: Pick<ResolvedTimePolicy, "timezone">,
	browserTz: string | null | undefined,
): string {
	return browserTz && isValidTimezone(browserTz) ? browserTz : policy.timezone;
}

/** The card's sentence. */
export function policyConfirmSentence(
	name: string,
	policy: PolicyFacts,
	timeZone: string,
): string {
	const workspace = name.trim() || "This workspace";
	if (!workspaceTrackingOn(policy)) {
		return POLICY_CONFIRM_COPY.trackingOff(workspace);
	}
	return `${workspace} tracks time ${policyPeriodPhrase(policy)} in ${timeZone}.`;
}

/**
 * The "Looks right" body: the values the sentence shows, plus `confirm`.
 * Tracking off shows no period or timezone, so it sends only the switch
 * (and never touches what it did not show).
 */
export function policyConfirmBody(
	policy: PolicyFacts,
	timeZone: string,
): WorkspaceTimePolicyInput {
	if (!workspaceTrackingOn(policy)) {
		return { confirm: true, tracking_enabled: false };
	}
	return {
		confirm: true,
		tracking_enabled: true,
		period_kind: policy.period_kind,
		week_start: policy.week_start,
		timezone: timeZone,
	};
}

/** The items that get a card. */
export function unconfirmedAdmins(
	admins: readonly WorkspaceTimeAdmin[] | null | undefined,
): WorkspaceTimeAdmin[] {
	return (admins ?? []).filter(
		(item) => item.policy_unconfirmed && item.has_time_tracking,
	);
}

export interface PolicyConfirmCardProps {
	/** `GET /time/me/overview` → `workspace_time_admin`. */
	admins: readonly WorkspaceTimeAdmin[] | null | undefined;
	/** Overrides the browser timezone (tests). */
	timeZone?: string;
	className?: string;
}

/** One card per workspace that still needs its policy confirmed; nothing otherwise. */
export function PolicyConfirmCard({
	admins,
	timeZone,
	className,
}: PolicyConfirmCardProps) {
	const items = unconfirmedAdmins(admins);
	if (items.length === 0) return null;
	return (
		<div className={cn("space-y-2", className)}>
			{items.map((item) => (
				<PolicyConfirmItem
					key={item.workspace_id}
					admin={item}
					timeZone={timeZone}
				/>
			))}
		</div>
	);
}

const BUTTON =
	"inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-60";

function PolicyConfirmItem({
	admin,
	timeZone,
}: {
	admin: WorkspaceTimeAdmin;
	timeZone?: string;
}) {
	const queryClient = useQueryClient();
	const browserTz = timeZone ?? browserTimeZone();
	// A manager's ?tz= materialises a missing row with their browser timezone.
	const policyQuery = useQuery(
		timeQueries.workspacePolicy(admin.workspace_id, { tz: browserTz }),
	);
	const [confirmed, setConfirmed] = useState(false);
	const confirm = useMutation({
		mutationFn: (body: WorkspaceTimePolicyInput) =>
			timeService.updateWorkspacePolicy(admin.workspace_id, body),
		onSuccess: (view) => {
			setConfirmed(true);
			queryClient.setQueryData(
				timeKeys.workspacePolicy(admin.workspace_id),
				view,
			);
			void invalidateTime(queryClient, "policy");
		},
	});

	const view = policyQuery.data;
	if (confirmed) return null;
	// Gone (no longer an admin) or failed: the overview offers it again later.
	if (policyQuery.isError) return null;
	// Someone confirmed it meanwhile, or this view is read-only.
	if (view && (!view.policy_unconfirmed || !view.can_edit)) return null;

	if (!view) {
		return (
			<div
				role="status"
				aria-busy="true"
				data-testid="policy-confirm-loading"
				className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
			>
				<Loader2
					className="h-4 w-4 animate-spin text-muted-foreground"
					aria-hidden="true"
				/>
				<span className="h-3 w-64 max-w-full animate-pulse rounded bg-muted" />
			</div>
		);
	}

	const tz = confirmTimeZone(view.policy, browserTz);
	const sentence = nativeSafe(
		policyConfirmSentence(admin.name, view.policy, tz),
	);
	const error = confirm.error
		? timeErrorMessage(confirm.error, {
				operation: "write",
				subject: "scope",
				workspaceName: admin.name,
			})
		: null;

	return (
		<section
			data-testid="policy-confirm-card"
			data-workspace={admin.workspace_id}
			aria-label={`${admin.name} time policy`}
			className="flex flex-col gap-3 rounded-xl border border-l-4 border-border border-l-info bg-card px-4 py-3 sm:flex-row sm:items-center"
		>
			<div className="flex min-w-0 flex-1 items-start gap-3">
				<CalendarClock
					className="mt-0.5 h-4 w-4 shrink-0 text-info"
					aria-hidden="true"
				/>
				<div className="min-w-0">
					<p className="text-sm text-foreground">{sentence}</p>
					{error ? (
						<p role="alert" className="mt-1 text-xs text-destructive">
							{error}
						</p>
					) : null}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2 max-sm:pl-7">
				<button
					type="button"
					disabled={confirm.isPending}
					onClick={() => confirm.mutate(policyConfirmBody(view.policy, tz))}
					className={cn(
						BUTTON,
						"border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
					)}
				>
					{confirm.isPending ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
					) : null}
					{POLICY_CONFIRM_COPY.looksRight}
				</button>
				{admin.slug ? (
					<Link
						to="/w/$workspaceSlug/settings/time"
						params={{ workspaceSlug: admin.slug }}
						className={cn(
							BUTTON,
							"border-border bg-background text-foreground hover:bg-muted",
						)}
					>
						{POLICY_CONFIRM_COPY.change}
					</Link>
				) : null}
			</div>
		</section>
	);
}
