import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { useTeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";

export type TeamMoneyNeed = "approver" | "rates" | "payouts";

export interface TeamMoneyGateProps {
	teamId: string;
	/**
	 * What the children require. "approver" = time tracking on + caller is the
	 * team owner or an owner/admin member (Team Logs). "rates" and "payouts" add
	 * the matching team switch (Manage Rates / Payouts).
	 */
	need: TeamMoneyNeed;
	/**
	 * Rendered under the copy when a team switch is off (e.g. a Link to the
	 * team's time settings). Omitted -> the card only explains.
	 */
	settingsLink?: ReactNode;
	children: ReactNode;
}

type Blocked = "time" | "access" | "rates" | "payouts";

const COPY: Record<Blocked, { title: string; body: string }> = {
	time: {
		title: "Time tracking is not enabled for this team.",
		body: "Time tracking lets members log time on tasks across this team's projects, and lets owners and admins approve those logs and manage rates. The team owner or a team admin can enable it from team settings.",
	},
	access: {
		title: "You don't have access to this team's time and pay.",
		body: "Team owners and admins review logs, manage rates, and record payouts. Ask a team admin to promote you if you need to manage them.",
	},
	rates: {
		title: "Member rates are turned off for this team.",
		body: "This team tracks hours only — they carry no rate, so there is nothing to price here. The team owner can turn member rates on from time settings.",
	},
	payouts: {
		title: "Payouts are turned off for this team.",
		body: "This team prices its hours but settles pay outside Proyekto, so there are no cut-off periods or payment records. The team owner can turn payouts on from time settings.",
	},
};

/**
 * Standalone gate for the team money panels (TeamLogsPanel, TeamRatesPanel,
 * TeamPayoutsPanel) when they are mounted outside the workspace Time layout,
 * which does this gating itself in time/route.tsx.
 */
export function TeamMoneyGate({
	teamId,
	need,
	settingsLink,
	children,
}: TeamMoneyGateProps) {
	const access = useTeamMoneyAccess(teamId);

	if (access.isLoading) {
		return (
			<div className="flex justify-center p-12">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const blocked: Blocked | null = !access.timeTrackingEnabled
		? "time"
		: !access.isApprover
			? "access"
			: need === "rates" && !access.hasRates
				? "rates"
				: need === "payouts" && !access.canPay
					? "payouts"
					: null;

	if (!blocked) return <>{children}</>;

	const copy = COPY[blocked];
	// An access problem is not fixed from settings; every other block is.
	const showSettings = blocked !== "access" && settingsLink;

	return (
		<AppSurfaceCard>
			<div className="space-y-3 p-6 text-sm text-muted-foreground">
				<p className="font-semibold text-foreground">{copy.title}</p>
				<p>{copy.body}</p>
				{showSettings ? <div>{settingsLink}</div> : null}
			</div>
		</AppSurfaceCard>
	);
}
