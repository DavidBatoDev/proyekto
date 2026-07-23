import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Clock, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ProjectSettingsLayout } from "@/components/project/ProjectSettingsLayout";
import { useToast } from "@/hooks/useToast";
import { projectService } from "@/services/project.service";
import {
	listMemberRates,
	listProjectTeams,
	listTeamMembers,
	type TeamMember,
	type TeamMemberRate,
	updateMemberRate,
} from "@/services/teams.service";
import { useAuthStore, useUser } from "@/stores/authStore";

export const Route = createFileRoute("/project/$projectId/settings/time")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: ProjectTimeSettings,
});

function memberLabel(m: TeamMember): string {
	const composed = [m.user?.first_name, m.user?.last_name]
		.filter(Boolean)
		.join(" ")
		.trim();
	return m.user?.display_name || composed || m.user?.email || m.user_id;
}

function ProjectTimeSettings() {
	const { projectId } = Route.useParams();
	const user = useUser();

	const projectQuery = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => projectService.get(projectId),
	});
	const project = projectQuery.data;
	const isConsultant = Boolean(
		user?.id && project?.consultant_id === user.id,
	);

	const teamsQuery = useQuery({
		queryKey: ["project", projectId, "teams"],
		queryFn: () => listProjectTeams(projectId),
		enabled: isConsultant,
	});
	const teams = teamsQuery.data ?? [];

	// Members across every team attached to this project.
	const memberQueries = useQueries({
		queries: teams.map((t) => ({
			queryKey: ["team", t.team_id, "members"] as const,
			queryFn: () => listTeamMembers(t.team_id),
			enabled: isConsultant,
		})),
	});
	const rows = teams.flatMap((t, i) =>
		(memberQueries[i]?.data ?? []).map((member) => ({
			teamId: t.team_id,
			member,
		})),
	);

	return (
		<ProjectSettingsLayout projectId={projectId}>
			<section className="space-y-4">
				<div className="flex items-center gap-2">
					<Clock className="h-5 w-5 text-slate-700" />
					<h2 className="text-[30px] font-semibold leading-none text-slate-900">
						Time &amp; hour limits
					</h2>
				</div>

				{projectQuery.isPending ? (
					<div className="flex justify-center p-12">
						<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
					</div>
				) : !isConsultant ? (
					<div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
						<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
						<div>
							<div className="font-semibold">Consultant only</div>
							<p className="mt-0.5">
								Only the project's consultant can view and manage per-member
								hour limits.
							</p>
						</div>
					</div>
				) : (
					<div className="app-surface-card-strong overflow-hidden rounded-2xl">
						<div className="space-y-4 px-5 py-6">
							<p className="max-w-2xl text-sm text-slate-600">
								Cap how many hours each team member can log on this project per
								week or month. Members see their progress in My Logs; when
								“block” is on, logging past the cap needs your approval. Leave
								blank for no limit.
							</p>

							{teamsQuery.isPending ||
							memberQueries.some((q) => q.isPending) ? (
								<div className="flex justify-center p-8">
									<Loader2 className="h-5 w-5 animate-spin text-slate-400" />
								</div>
							) : teams.length === 0 ? (
								<div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
									No team is attached to this project yet. Attach a team under
									Settings → Teams to manage hour limits.
								</div>
							) : rows.length === 0 ? (
								<div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
									No members on the attached team(s) yet.
								</div>
							) : (
								<ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
									{rows.map((row) => (
										<LimitRow
											key={`${row.teamId}:${row.member.user_id}`}
											projectId={projectId}
											teamId={row.teamId}
											member={row.member}
										/>
									))}
								</ul>
							)}
						</div>
					</div>
				)}
			</section>
		</ProjectSettingsLayout>
	);
}

function LimitRow({
	projectId,
	teamId,
	member,
}: {
	projectId: string;
	teamId: string;
	member: TeamMember;
}) {
	const toast = useToast();
	const qc = useQueryClient();

	const ratesQuery = useQuery({
		queryKey: ["team", teamId, "rates", "history", member.user_id, projectId],
		queryFn: () => listMemberRates(teamId, member.user_id, projectId),
	});
	const activeRate: TeamMemberRate | undefined = (ratesQuery.data ?? []).find(
		(r) => r.end_date === null,
	);

	return (
		<li className="px-3 py-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2.5">
					{member.user?.avatar_url ? (
						<img
							src={member.user.avatar_url}
							alt={memberLabel(member)}
							className="h-8 w-8 shrink-0 rounded-full object-cover"
						/>
					) : (
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold uppercase text-slate-600">
							{memberLabel(member).trim().charAt(0) || "?"}
						</div>
					)}
					<div className="min-w-0">
						<div className="truncate text-sm font-medium text-slate-800">
							{memberLabel(member)}
						</div>
						{member.position && (
							<div className="truncate text-[11px] text-slate-500">
								{member.position}
							</div>
						)}
					</div>
				</div>

				{ratesQuery.isPending ? (
					<Loader2 className="h-4 w-4 animate-spin text-slate-400" />
				) : activeRate ? (
					<LimitEditor
						rate={activeRate}
						onSaved={() =>
							qc.invalidateQueries({
								queryKey: [
									"team",
									teamId,
									"rates",
									"history",
									member.user_id,
									projectId,
								],
							})
						}
						onError={(m) => toast.error(m)}
						onSuccess={(m) => toast.success(m)}
						teamId={teamId}
						userId={member.user_id}
					/>
				) : (
					<span className="text-xs italic text-slate-400">
						No rate on this project — set one in Team → Manage Rates first.
					</span>
				)}
			</div>
		</li>
	);
}

function LimitEditor({
	rate,
	teamId,
	userId,
	onSaved,
	onSuccess,
	onError,
}: {
	rate: TeamMemberRate;
	teamId: string;
	userId: string;
	onSaved: () => void;
	onSuccess: (msg: string) => void;
	onError: (msg: string) => void;
}) {
	const [weekly, setWeekly] = useState(
		rate.weekly_limit_hours == null ? "" : String(rate.weekly_limit_hours),
	);
	const [monthly, setMonthly] = useState(
		rate.monthly_limit_hours == null ? "" : String(rate.monthly_limit_hours),
	);
	const [block, setBlock] = useState(Boolean(rate.overtime_requires_approval));

	const dirty =
		weekly !==
			(rate.weekly_limit_hours == null ? "" : String(rate.weekly_limit_hours)) ||
		monthly !==
			(rate.monthly_limit_hours == null
				? ""
				: String(rate.monthly_limit_hours)) ||
		block !== Boolean(rate.overtime_requires_approval);

	const mutation = useMutation({
		mutationFn: () =>
			updateMemberRate(teamId, userId, rate.id, {
				weekly_limit_hours: weekly === "" ? null : Number(weekly),
				monthly_limit_hours: monthly === "" ? null : Number(monthly),
				overtime_requires_approval: block,
			}),
		onSuccess: () => {
			onSuccess("Hour limits saved");
			onSaved();
		},
		onError: (e: Error) => onError(e.message),
	});

	return (
		<div className="flex flex-wrap items-center gap-2">
			<label className="flex items-center gap-1 text-[11px] text-slate-500">
				Weekly
				<input
					type="number"
					min={0}
					step="0.5"
					value={weekly}
					onChange={(e) => setWeekly(e.target.value)}
					placeholder="—"
					className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums"
				/>
			</label>
			<label className="flex items-center gap-1 text-[11px] text-slate-500">
				Monthly
				<input
					type="number"
					min={0}
					step="0.5"
					value={monthly}
					onChange={(e) => setMonthly(e.target.value)}
					placeholder="—"
					className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums"
				/>
			</label>
			<label
				className="flex items-center gap-1 text-[11px] text-slate-500"
				title="Block logging past a limit (otherwise members just get a warning)"
			>
				<input
					type="checkbox"
					checked={block}
					onChange={(e) => setBlock(e.target.checked)}
					className="h-3.5 w-3.5 rounded border-slate-300"
				/>
				Block
			</label>
			<button
				type="button"
				onClick={() => mutation.mutate()}
				disabled={!dirty || mutation.isPending}
				className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
			>
				{mutation.isPending ? "Saving…" : "Save"}
			</button>
		</div>
	);
}
