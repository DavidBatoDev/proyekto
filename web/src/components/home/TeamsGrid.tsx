import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Mail, Plus, User, Users } from "lucide-react";
import {
	listMyTeamInvites,
	listMyTeams,
	type ProfileSummary,
	type Team,
	type TeamInvite,
} from "@/services/teams.service";
import { TeamAvatar } from "@/components/team/TeamAvatar";
import { useUser } from "@/stores/authStore";

const AVATAR_PREVIEW_LIMIT = 6;

type TeamsCard =
	| { kind: "invite"; invite: TeamInvite }
	| { kind: "team"; team: Team };

export function TeamsGrid() {
	const user = useUser();
	const teamsQuery = useQuery({
		queryKey: ["teams", "mine", user?.id ?? "anonymous"] as const,
		queryFn: listMyTeams,
		enabled: Boolean(user?.id),
		staleTime: 30 * 1000,
	});
	const invitesQuery = useQuery({
		queryKey: ["teams", "my-invites"],
		queryFn: listMyTeamInvites,
		enabled: Boolean(user?.id),
		staleTime: 30 * 1000,
	});
	const teams = (teamsQuery.data as Team[] | undefined) ?? [];
	const pendingInvites = (
		(invitesQuery.data as TeamInvite[] | undefined) ?? []
	).filter((i) => i.status === "pending");
	const isLoading = teamsQuery.isPending || invitesQuery.isPending;

	// Dashboard preview is a single row: pending invites first (they're
	// time-sensitive), then the 3 most recently updated teams. Anything
	// beyond that lives on the /teams page.
	const recentTeams = [...teams]
		.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
		.slice(0, 3);

	const cards: TeamsCard[] = [
		...pendingInvites.map<TeamsCard>((invite) => ({
			kind: "invite",
			invite,
		})),
		...recentTeams.map<TeamsCard>((team) => ({ kind: "team", team })),
	].slice(0, 3);

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
				) : cards.length === 0 ? (
					<TeamsEmptyState className="col-span-full" />
				) : (
					cards.map((card) =>
						card.kind === "invite" ? (
							<TeamInviteCard key={card.invite.id} invite={card.invite} />
						) : (
							<TeamCard key={card.team.id} team={card.team} />
						),
					)
				)}
			</div>
		</div>
	);
}

function TeamCard({ team }: { team: Team }) {
	const totalMembers = team.members_count ?? 0;
	const previews = (team.members_preview ?? []).filter(
		(p): p is ProfileSummary => Boolean(p),
	);
	const visible = previews.slice(0, AVATAR_PREVIEW_LIMIT);
	const overflow = Math.max(totalMembers - visible.length, 0);

	return (
		<Link
			to="/teams/$teamId"
			params={{ teamId: team.id }}
			className="group flex h-40 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-lg"
		>
			<div className="flex items-start gap-2.5">
				<TeamAvatar team={team} />
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-[14px] font-semibold leading-tight text-slate-900">
						{team.name || "Untitled team"}
					</h3>
					<TeamCardSubLine team={team} />
				</div>
			</div>

			<div className="mt-auto flex items-center justify-between gap-2 pt-3">
				<p className="text-[11px] text-slate-500">
					{totalMembers === 1 ? "1 member" : `${totalMembers} members`}
				</p>
				<div className="flex items-center justify-end">
					<AvatarStack members={visible} overflow={overflow} />
					<span className="ml-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition-transform duration-200 group-hover:translate-x-0.5">
						<ArrowRight className="h-3 w-3" />
					</span>
				</div>
			</div>
		</Link>
	);
}

function TeamCardSubLine({ team }: { team: Team }) {
	const role = team.viewer_role;
	const position = team.viewer_position;
	const description = team.description ?? (team.is_personal ? "My team" : null);

	const chip = position ? (
		<span className="inline-flex shrink-0 items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
			{position}
		</span>
	) : role ? (
		<span className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
			{role}
		</span>
	) : null;

	if (!chip && !description) return null;

	return (
		<div className="mt-1 flex min-w-0 items-center gap-1.5">
			{chip}
			{description && (
				<span className="min-w-0 truncate text-xs text-slate-500">
					{description}
				</span>
			)}
		</div>
	);
}

function AvatarStack({
	members,
	overflow,
}: {
	members: ProfileSummary[];
	overflow: number;
}) {
	if (members.length === 0 && overflow === 0) {
		return <span className="text-[11px] text-slate-400">No members</span>;
	}
	return (
		<div className="flex -space-x-1.5">
			{members.map((m) => (
				<MemberAvatar key={m.id} profile={m} />
			))}
			{overflow > 0 && (
				<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[9px] font-semibold text-slate-600 ring-1 ring-slate-200">
					+{overflow}
				</div>
			)}
		</div>
	);
}

function MemberAvatar({ profile }: { profile: ProfileSummary }) {
	const name =
		profile.display_name ||
		[profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
		profile.email ||
		"";
	const initial = name.trim().charAt(0).toUpperCase();
	if (profile.avatar_url) {
		return (
			<img
				src={profile.avatar_url}
				alt={name}
				title={name}
				className="h-6 w-6 shrink-0 rounded-full border-2 border-white object-cover ring-1 ring-slate-200"
			/>
		);
	}
	return (
		<div
			title={name}
			className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[9px] font-semibold text-slate-700 ring-1 ring-slate-200"
		>
			{initial || <User className="h-2.5 w-2.5" />}
		</div>
	);
}

function TeamInviteCard({ invite }: { invite: TeamInvite }) {
	const teamName = invite.team?.name || "Team";
	const inviterName =
		invite.invited_by_profile?.display_name ||
		[
			invite.invited_by_profile?.first_name,
			invite.invited_by_profile?.last_name,
		]
			.filter(Boolean)
			.join(" ") ||
		invite.invited_by_profile?.email ||
		"A team owner";

	return (
		<Link
			to="/teams/me/invites"
			className="group flex h-40 flex-col rounded-2xl border border-slate-900 bg-slate-900 p-4 text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-lg"
		>
			<div className="flex items-start gap-3">
				<div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white">
					<span
						aria-hidden="true"
						className="invite-glow-halo pointer-events-none absolute inset-0 rounded-xl bg-white/40 blur-md"
					/>
					<Mail className="invite-glow-icon relative h-5 w-5" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="mb-1 flex items-center gap-2">
						<span className="inline-flex items-center rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
							Pending invite
						</span>
					</div>
					<h3 className="truncate text-[15px] font-semibold text-white">
						{teamName}
					</h3>
					<p className="mt-0.5 truncate text-[12px] text-slate-300">
						{inviterName} invited you ·{" "}
						{invite.position
							? `${invite.position} (${invite.role})`
							: invite.role}
					</p>
				</div>
			</div>

			<div className="mt-auto flex items-center justify-end pt-3">
				<span className="text-[13px] font-semibold uppercase text-white/80 transition-colors group-hover:text-white">
					Open invite -&gt;
				</span>
			</div>
		</Link>
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
		<div className="h-40 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
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
