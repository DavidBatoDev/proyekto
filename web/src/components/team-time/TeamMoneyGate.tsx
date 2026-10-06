import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { FinanceQueryError } from "@/components/finance/access/FinanceAccessStates";
import { useTeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { isNativeApp } from "@/lib/platform";
import { NATIVE_FALLBACK_COPY } from "@/lib/timeErrors";

export type TeamMoneyNeed = "approver" | "rates" | "payouts";

export interface TeamMoneyGateProps {
	teamId: string;
	/**
	 * What the children require. "approver" = time tracking on + the caller
	 * manages the team (the team owner or an owner/admin member: the team
	 * report). "rates" and "payouts" add the matching team switch.
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

/** Web copy. "Rates" and "payouts" are money words the app never shows. */
export const TEAM_MONEY_GATE_COPY: Record<
	Blocked,
	{ title: string; body: string }
> = {
	time: {
		title: "Time tracking is off for this team.",
		body: "With time tracking on, members track time for this team on its projects, and the team's owners and admins see it in the team's time report. The team owner or a team admin can turn it on from team settings.",
	},
	access: {
		title: "You don't have access to this team's time and pay.",
		body: "Team owners and admins see the team's time report, manage member rates and record payouts. Ask a team admin if you need to manage them.",
	},
	rates: {
		title: "Member rates are turned off for this team.",
		body: "This team tracks hours only. Its time carries no rate, so there is nothing to price here. The team owner can turn member rates on from team settings.",
	},
	payouts: {
		title: "Payouts are turned off for this team.",
		body: "This team prices its time but settles pay outside Proyekto, so there are no payments to record here. The team owner can turn payouts on from team settings.",
	},
};

/** The installed app's wording for the blocks it can still show (the team report only). */
export const TEAM_MONEY_GATE_NATIVE_COPY: Record<
	"time" | "access",
	{ title: string; body: string }
> = {
	time: {
		title: "Time tracking is off for this team.",
		body: "The team owner or a team admin can turn it on from team settings.",
	},
	access: {
		title: "You don't have access to this team's time.",
		body: "Team owners and admins see the team's time report. Ask a team admin if you need it.",
	},
};

/**
 * Standalone gate for the team money panels (TeamRatesPanel,
 * TeamPayoutsPanel) and the team report when they are mounted outside the
 * team Time layout (Engagements › Finance › team), which does this gating
 * itself in time/route.tsx.
 *
 * The plan is not a gate here: rates stay editable and payment history stays
 * readable and voidable on any plan. The panels state a missing plan feature
 * inline (`time_team_rules`, `time_payouts`).
 *
 * In the installed app, rates and payouts are web-only surfaces (L54), so
 * those needs render a "use the web" card and never their children.
 */
export function TeamMoneyGate({
	teamId,
	need,
	settingsLink,
	children,
}: TeamMoneyGateProps) {
	const native = isNativeApp();
	const moneySurface = need === "rates" || need === "payouts";
	const access = useTeamMoneyAccess(teamId);

	if (native && moneySurface) {
		return <TimeReasonCard tone="neutral" title={NATIVE_FALLBACK_COPY} />;
	}

	if (access.isLoading) {
		return (
			<div className="flex justify-center p-12">
				<Loader2
					className="h-6 w-6 animate-spin text-muted-foreground"
					aria-hidden="true"
				/>
			</div>
		);
	}

	// A refusal or failure loading the team is not "time tracking is off".
	if (access.error) {
		return <FinanceQueryError error={access.error} scope="team" />;
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

	const copy =
		native && (blocked === "time" || blocked === "access")
			? TEAM_MONEY_GATE_NATIVE_COPY[blocked]
			: TEAM_MONEY_GATE_COPY[blocked];
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
