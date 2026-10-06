import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useTeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";
import { TimeEntryDetailModal } from "@/components/time/entries/TimeEntryDetailModal";
import { TimeReport } from "@/components/time/report/TimeReport";
import {
	validateTeamTimeReportSearch,
	validateTimePageSearch,
} from "@/lib/timeSearch";
import { timeQueries } from "@/queries/time";
import { getTeam, listTeamMembers } from "@/services/teams.service";
import type { TimeEntryView } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

/**
 * `/w/<slug>/teams/<t>/time`: the team Report (ux.md › Routes and Redirects).
 *
 * - A team manager gets the Report in place (this page used to redirect).
 * - A member is sent to their own time for the team, `/time?for=team:<t>`.
 * - Anyone else stays here and the layout shows the refusal card.
 *
 * The decision is made in `beforeLoad` so a member never sees the layout
 * flash. It reads the team and its members under the same keys
 * `useTeamMoneyAccess` uses, so the layout renders from the cache. A failed
 * read decides nothing: the page renders and the layout says what failed.
 */
export const Route = createFileRoute("/w/$workspaceSlug/teams/$teamId/time/")({
	validateSearch: validateTeamTimeReportSearch,
	beforeLoad: async ({ params, context }) => {
		const userId = useAuthStore.getState().user?.id;
		if (!userId) return;
		const standing = await Promise.all([
			context.queryClient.ensureQueryData({
				queryKey: ["team", params.teamId],
				queryFn: () => getTeam(params.teamId),
			}),
			context.queryClient.ensureQueryData({
				queryKey: ["team", params.teamId, "members"],
				queryFn: () => listTeamMembers(params.teamId),
			}),
		]).catch(() => null);
		if (!standing) return;
		const [team, members] = standing;
		const membership = members.find((member) => member.user_id === userId);
		const manages =
			team.owner_id === userId ||
			membership?.role === "owner" ||
			membership?.role === "admin";
		if (manages || !membership) return;
		throw redirect({
			to: "/time",
			search: validateTimePageSearch({ for: `team:${params.teamId}` }),
			replace: true,
		});
	},
	component: TeamTimeReportPage,
});

/**
 * The Report body. The layout (`route.tsx`) has already checked that the
 * caller manages the team and that team time is on, so this only mounts the
 * shared `TimeReport` on the team scope, in the team's policy timezone.
 */
function TeamTimeReportPage() {
	const { teamId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const access = useTeamMoneyAccess(teamId);
	const [openEntry, setOpenEntry] = useState<TimeEntryView | null>(null);

	// Team policy reads are manager-only (404 otherwise); the layout only
	// renders this page for managers, the guard keeps a stray mount quiet.
	const policyQuery = useQuery(
		timeQueries.teamPolicy(access.isApprover ? teamId : null),
	);

	// The default range is counted in the team's timezone, so wait for it
	// once; a failed read falls back to the device's.
	if (policyQuery.isLoading) {
		return (
			<div className="flex justify-center p-12" role="status">
				<Loader2
					className="h-6 w-6 animate-spin text-muted-foreground"
					aria-hidden="true"
				/>
				<span className="sr-only">Loading</span>
			</div>
		);
	}

	const policy = policyQuery.data?.effective;
	const planWorkspace = access.planWorkspace;

	return (
		<>
			<TimeReport
				scope={{ kind: "team", id: teamId }}
				search={search}
				onSearchChange={(patch) =>
					void navigate({
						search: (prev) => ({ ...prev, ...patch }),
						replace: true,
					})
				}
				timezone={policy?.timezone ?? null}
				weekStart={policy?.week_start ?? null}
				planWorkspace={
					access.planWorkspaceId
						? {
								id: access.planWorkspaceId,
								name: planWorkspace?.name,
								slug: planWorkspace?.slug,
								my_role: planWorkspace?.my_role,
							}
						: null
				}
				// The pay cut-offs are presets only where the team records payments.
				cutoffs={
					access.canPay
						? { config: access.team?.pay_period_config ?? null }
						: null
				}
				onOpenEntry={setOpenEntry}
			/>
			<TimeEntryDetailModal
				entryId={openEntry?.id ?? null}
				entry={openEntry}
				mode="readonly"
				timeZone={policy?.timezone}
				onClose={() => setOpenEntry(null)}
			/>
		</>
	);
}
