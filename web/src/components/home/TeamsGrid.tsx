import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Plus, Users } from "lucide-react";
import { listMyTeams, type Team } from "@/services/teams.service";
import { useUser } from "@/stores/authStore";

export function TeamsGrid() {
	const user = useUser();
	const teamsQuery = useQuery({
		queryKey: ["teams", "mine", user?.id ?? "anonymous"] as const,
		queryFn: listMyTeams,
		enabled: Boolean(user?.id),
		staleTime: 30 * 1000,
	});
	const teams = (teamsQuery.data as Team[] | undefined) ?? [];
	const isLoading = teamsQuery.isPending;

	return (
		<div id="my-teams" className="app-slide-up scroll-mt-6">
			<div className="mb-4 flex items-end justify-between gap-3">
				<div>
					<div className="flex items-center gap-2">
						<div className="h-[18px] w-[18px] rounded-full bg-slate-900" />
						<h2 className="text-[20px] font-semibold tracking-tight text-slate-900">
							TEAMS
						</h2>
					</div>
					<p className="mt-1 text-xs text-slate-600">
						Reusable groups of people you can attach to any project.
					</p>
				</div>
				<Link
					to="/teams"
					className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-slate-700 hover:text-slate-900"
				>
					All teams
					<ArrowRight className="h-3.5 w-3.5" />
				</Link>
			</div>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{isLoading ? (
					<>
						<TeamCardSkeleton />
						<TeamCardSkeleton />
						<TeamCardSkeleton />
					</>
				) : teams.length === 0 ? (
					<TeamsEmptyState className="col-span-full" />
				) : (
					<>
						{teams.slice(0, 5).map((team) => (
							<TeamCard key={team.id} team={team} />
						))}
						<CreateTeamCard />
					</>
				)}
			</div>
		</div>
	);
}

function TeamCard({ team }: { team: Team }) {
	return (
		<Link
			to="/teams/$teamId"
			params={{ teamId: team.id }}
			className="group flex h-[160px] flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-lg"
		>
			<div className="flex items-start gap-3">
				<TeamAvatar team={team} />
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-[15px] font-semibold text-slate-900">
						{team.name || "Untitled team"}
					</h3>
					{team.description ? (
						<p className="mt-1 line-clamp-2 text-[13px] text-slate-600">
							{team.description}
						</p>
					) : (
						<p className="mt-1 text-[13px] text-slate-400">No description</p>
					)}
				</div>
			</div>

			<div className="mt-auto flex items-center justify-end pt-3">
				<span className="text-[13px] font-semibold uppercase text-slate-700 transition-colors group-hover:text-slate-900">
					Open team -&gt;
				</span>
			</div>
		</Link>
	);
}

function CreateTeamCard() {
	return (
		<Link
			to="/teams"
			className="group flex h-[160px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/40 p-4 text-slate-500 transition hover:border-slate-400 hover:bg-white hover:text-slate-900"
		>
			<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600 group-hover:bg-slate-900 group-hover:text-white">
				<Plus className="h-5 w-5" />
			</div>
			<span className="text-[13px] font-semibold">Create or browse teams</span>
		</Link>
	);
}

function TeamAvatar({ team }: { team: Team }) {
	if (team.avatar_url) {
		return (
			<img
				src={team.avatar_url}
				alt={team.name}
				className="h-10 w-10 shrink-0 rounded-xl object-cover"
			/>
		);
	}
	const initial = (team.name?.trim()[0] || "T").toUpperCase();
	return (
		<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
			<span className="text-sm font-semibold">{initial}</span>
		</div>
	);
}

function TeamsEmptyState({ className }: { className?: string }) {
	return (
		<div
			className={`rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center shadow-sm ${className ?? ""}`}
		>
			<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
				<Users className="h-5 w-5 text-slate-600" />
			</div>
			<h4 className="mb-1 text-base font-semibold text-slate-900">
				No teams yet
			</h4>
			<p className="mx-auto mb-4 max-w-md text-sm text-slate-600">
				Create a team to group the people you collaborate with, then attach
				the team to any project.
			</p>
			<Link
				to="/teams"
				className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
			>
				<Plus className="h-4 w-4" />
				Create team
			</Link>
		</div>
	);
}

function TeamCardSkeleton() {
	return (
		<div className="h-[160px] rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
			<div className="flex items-start gap-3">
				<div className="h-10 w-10 animate-pulse rounded-xl bg-slate-200" />
				<div className="flex-1 space-y-2">
					<div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
					<div className="h-3 w-full animate-pulse rounded bg-slate-100" />
					<div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
				</div>
			</div>
		</div>
	);
}
