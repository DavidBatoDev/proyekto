import { useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
import {
	BarChart3,
	Coins,
	Loader2,
	type LucideIcon,
	Settings2,
	Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import {
	TEAM_MONEY_GATE_COPY,
	TEAM_MONEY_GATE_NATIVE_COPY,
} from "@/components/team-time/TeamMoneyGate";
import { useTeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";
import { REPORT_COPY } from "@/components/time/report/reportModel";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { isAccessDeniedError } from "@/lib/apiErrors";
import { isNativeApp } from "@/lib/platform";
import { filterNavByPlatform } from "@/lib/platformSurfaces";
import { timeErrorCopy } from "@/lib/timeErrors";
import { validateTimePageSearch } from "@/lib/timeSearch";
import { cn } from "@/lib/utils";
import { requireAuthenticatedUserId } from "@/lib/workspaceRouting";

/**
 * Team › Time (ux.md › Reports, Routes and Redirects): the team's own time
 * surfaces for the people who manage the team, under the sub-nav
 * Report · Rates · Payouts. Logging, submitting and approving moved to the
 * personal `/time` page, so the old My Logs and Team Logs tabs are gone; their
 * routes are redirect stubs that never render this layout.
 *
 * - Team managers (`can_manage_team`: the team owner, or an owner/admin
 *   member) get the sub-nav and the page.
 * - Members are sent to `/time?for=team:<t>` by the index before this renders;
 *   one who opens Rates or Payouts by URL gets the refusal card with a way
 *   into Time.
 * - Everyone else gets the refusal card. Nothing here is ever an empty page.
 * - In the app, Rates and Payouts are web-only (L54): `filterNavByPlatform`
 *   leaves the Report alone in the sub-nav.
 */
export const Route = createFileRoute("/w/$workspaceSlug/teams/$teamId/time")({
	beforeLoad: ({ location }) => {
		requireAuthenticatedUserId(location);
	},
	component: TeamTimeLayout,
});

type Section = "report" | "rates" | "payouts";

interface SubNavItem {
	id: Section;
	label: string;
	to:
		| "/w/$workspaceSlug/teams/$teamId/time"
		| "/w/$workspaceSlug/teams/$teamId/time/manage-rates"
		| "/w/$workspaceSlug/teams/$teamId/time/payouts";
	icon: LucideIcon;
}

const SUB_NAV: readonly SubNavItem[] = [
	{
		id: "report",
		label: "Report",
		to: "/w/$workspaceSlug/teams/$teamId/time",
		icon: BarChart3,
	},
	{
		id: "rates",
		label: "Rates",
		to: "/w/$workspaceSlug/teams/$teamId/time/manage-rates",
		icon: Coins,
	},
	{
		id: "payouts",
		label: "Payouts",
		to: "/w/$workspaceSlug/teams/$teamId/time/payouts",
		icon: Wallet,
	},
];

/** The ux.md Team override line for a team with time on. */
const TEAM_TIME_SUBTITLE =
	"Members log time for this team on attached projects.";

/**
 * Which sub-page the URL is on, read from the segments after the team id (a
 * workspace slug may itself be "time"). `null` on a path this layout does not
 * draw a tab for.
 */
function sectionOf(pathname: string, teamId: string): Section | null {
	const segments = pathname.split("/").filter(Boolean);
	const at = segments.lastIndexOf(teamId);
	if (at < 0 || segments[at + 1] !== "time") return null;
	const sub = segments[at + 2];
	if (sub === undefined) return "report";
	if (sub === "manage-rates") return "rates";
	if (sub === "payouts") return "payouts";
	return null;
}

function Frame({ children }: { children: ReactNode }) {
	return (
		<DashboardShell>
			<div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4 sm:p-6">
				{children}
			</div>
		</DashboardShell>
	);
}

const LINK_BUTTON =
	"inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-card-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const PRIMARY_LINK_BUTTON =
	"inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function TeamTimeLayout() {
	const { workspaceSlug, teamId } = Route.useParams();
	const pathname = useLocation({ select: (location) => location.pathname });
	const queryClient = useQueryClient();
	const native = isNativeApp();
	const access = useTeamMoneyAccess(teamId);
	const section = sectionOf(pathname, teamId);
	const params = { workspaceSlug, teamId };

	if (access.isLoading) {
		return (
			<Frame>
				<div className="flex justify-center p-12" role="status">
					<Loader2
						className="h-6 w-6 animate-spin text-muted-foreground"
						aria-hidden="true"
					/>
					<span className="sr-only">Loading</span>
				</div>
			</Frame>
		);
	}

	// A failure that is not a refusal says so and offers a retry; a refusal
	// (403/404) is the same card as having no standing on the team.
	if (access.error && !isAccessDeniedError(access.error)) {
		const copy = timeErrorCopy(access.error, {
			subject: "scope",
			operation: "read",
		});
		return (
			<Frame>
				<TimeReasonCard
					tone="danger"
					role="alert"
					title={copy.message}
					action={
						<button
							type="button"
							className={LINK_BUTTON}
							onClick={() =>
								void queryClient.refetchQueries({
									queryKey: ["team", teamId],
									type: "active",
								})
							}
						>
							{REPORT_COPY.retry}
						</button>
					}
				/>
			</Frame>
		);
	}

	const team = access.team;
	const settingsLink = (
		<Link
			to="/w/$workspaceSlug/teams/$teamId/settings/time"
			params={params}
			className={PRIMARY_LINK_BUTTON}
		>
			Open settings
		</Link>
	);

	if (!team || !access.isApprover) {
		const copy = native
			? TEAM_MONEY_GATE_NATIVE_COPY.access
			: TEAM_MONEY_GATE_COPY.access;
		return (
			<Frame>
				<TimeReasonCard
					tone="danger"
					title={copy.title}
					action={
						team ? (
							<>
								{access.isTeamMember ? (
									<Link
										to="/time"
										search={validateTimePageSearch({ for: `team:${teamId}` })}
										className={PRIMARY_LINK_BUTTON}
									>
										Open in Time
									</Link>
								) : null}
								<Link
									to="/w/$workspaceSlug/teams/$teamId"
									params={params}
									className={LINK_BUTTON}
								>
									Back to team
								</Link>
							</>
						) : null
					}
				>
					{copy.body}
				</TimeReasonCard>
			</Frame>
		);
	}

	if (!access.timeTrackingEnabled) {
		const copy = native
			? TEAM_MONEY_GATE_NATIVE_COPY.time
			: TEAM_MONEY_GATE_COPY.time;
		return (
			<Frame>
				<TeamTimeHeader teamName={team.name} params={params} />
				<TimeReasonCard tone="info" title={copy.title} action={settingsLink}>
					{copy.body}
				</TimeReasonCard>
			</Frame>
		);
	}

	// Rates and Payouts follow the team's switches; a hidden tab stays
	// reachable by URL (a bookmark from before the switch went off), so the
	// page answers here instead of mounting and failing against the API.
	const shown = SUB_NAV.filter(
		(item) =>
			item.id === "report" ||
			(item.id === "rates" && access.hasRates) ||
			(item.id === "payouts" && access.canPay),
	);
	const items = filterNavByPlatform(shown, native);
	const blocked =
		section === "rates" && !access.hasRates
			? "rates"
			: section === "payouts" && !access.canPay
				? "payouts"
				: null;

	return (
		<Frame>
			<TeamTimeHeader teamName={team.name} params={params} />
			<nav
				aria-label="Team time"
				className="-mx-4 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0"
			>
				<ul className="-mb-px flex gap-1 sm:gap-2">
					{items.map((item) => {
						const Icon = item.icon;
						const active = section === item.id;
						return (
							<li key={item.id} className="shrink-0">
								<Link
									to={item.to}
									params={params}
									aria-current={active ? "page" : undefined}
									className={cn(
										"inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										active
											? "border-primary text-primary"
											: "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
									)}
								>
									<Icon className="h-4 w-4" aria-hidden="true" />
									{item.label}
								</Link>
							</li>
						);
					})}
				</ul>
			</nav>

			{blocked ? (
				<TimeReasonCard
					tone="info"
					title={TEAM_MONEY_GATE_COPY[blocked].title}
					action={settingsLink}
				>
					{TEAM_MONEY_GATE_COPY[blocked].body}
				</TimeReasonCard>
			) : (
				<Outlet />
			)}
		</Frame>
	);
}

function TeamTimeHeader({
	teamName,
	params,
}: {
	teamName: string;
	params: { workspaceSlug: string; teamId: string };
}) {
	return (
		<header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div className="min-w-0">
				<h1 className="break-words text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
					Time · {teamName}
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					{TEAM_TIME_SUBTITLE}
				</p>
			</div>
			<Link
				to="/w/$workspaceSlug/teams/$teamId/settings/time"
				params={params}
				className={cn(LINK_BUTTON, "self-start sm:self-auto")}
			>
				<Settings2 className="h-4 w-4" aria-hidden="true" />
				Time settings
			</Link>
		</header>
	);
}
