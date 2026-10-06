// web/src/components/time/page/ApproverModeView.tsx
//
// Approver mode (ux.md › The Time Page, L36): for people who decide time but
// logged nothing in the last 30 days. Never an empty week:
//
//   WAITING FOR YOU (3)                                    [Approve selected]
//   ☐ Maria Santos   Prodigitality Servic… · Sep 22–28   38:15  2 days ago ⚠1
//   DECIDED IN THE LAST 30 DAYS
//   ✓ Maria Santos   Sep 15–21   40:00   Approved by you · Sep 23
//   ┌ Acme · Weekly · starts Monday · Asia/Manila · Approval required ─┐   only when
//   │                                             [Edit time policy]  │   nothing waits
//
// The timer bar is the header's single Start timer pill (the page renders
// it); the day strip and the list are not rendered. The first logged entry
// switches the page back to normal mode on the next overview fetch.
//
// With nothing waiting: a consultant (P5) reads "You're all caught up.
// Timesheets sent to you will show up here."; a workspace admin (P7) reads
// "You're all caught up." above one policy card per workspace they run
// (those still waiting for "Looks right" are the confirm card's instead).

import { cn } from "@/lib/utils";
import type { TimeOverview } from "@/services/time.types";
import { DecidedList } from "../approvals/DecidedList";
import { unconfirmedAdmins } from "./PolicyConfirmCard";
import { PolicySummaryCards } from "./PolicySummaryCards";
import { pickTimeEmptyState, timeEmptyText } from "./TimeEmptyStates";
import { WaitingSection } from "./WaitingSection";

export interface ApproverModeViewProps {
	overview: Pick<
		TimeOverview,
		| "approvals_waiting"
		| "workspace_time_admin"
		| "approver_mode"
		| "can_log"
		| "contexts"
	>;
	currentWorkspaceId?: string | null;
	floatingBar?: boolean;
	now?: Date;
	userTimezone?: string;
	className?: string;
}

/** The caught-up sentence for this person (P5 gets the hint line, P7 does not). */
export function caughtUpText(
	overview: ApproverModeViewProps["overview"],
): string {
	const { title, detail } = timeEmptyText(
		pickTimeEmptyState({ ...overview, approver_mode: true }),
	);
	return detail ? `${title} ${detail}` : title;
}

/** The workspace policy cards: every admin item the confirm card isn't showing. */
export function summaryAdmins(
	admins: TimeOverview["workspace_time_admin"] | null | undefined,
): TimeOverview["workspace_time_admin"] {
	const confirming = new Set(
		unconfirmedAdmins(admins).map((item) => item.workspace_id),
	);
	return (admins ?? []).filter((item) => !confirming.has(item.workspace_id));
}

export function ApproverModeView({
	overview,
	currentWorkspaceId,
	floatingBar = true,
	now,
	userTimezone,
	className,
}: ApproverModeViewProps) {
	const nothingWaits = overview.approvals_waiting <= 0;
	const policyAdmins = nothingWaits
		? summaryAdmins(overview.workspace_time_admin)
		: [];
	return (
		<div className={cn("space-y-6", className)} data-testid="approver-mode">
			<WaitingSection
				approverMode
				count={overview.approvals_waiting}
				emptyText={caughtUpText(overview)}
				currentWorkspaceId={currentWorkspaceId}
				floatingBar={floatingBar}
				now={now}
				userTimezone={userTimezone}
			/>
			<DecidedList
				currentWorkspaceId={currentWorkspaceId}
				now={now}
				userTimezone={userTimezone}
			/>
			{policyAdmins.length > 0 ? (
				<PolicySummaryCards admins={policyAdmins} />
			) : null}
		</div>
	);
}
