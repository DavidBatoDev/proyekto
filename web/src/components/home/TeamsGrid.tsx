import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowRight, Mail, Plus, User, Users } from "lucide-react";
import { useMemo } from "react";
import { PositionBadge, RoleBadge } from "@/components/common/SemanticBadge";
import { TeamAvatar } from "@/components/team/TeamAvatar";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { richTextToPlain } from "@/lib/richText";
import {
	useTourDemo,
	useTourDemoActive,
} from "@/lib/tours/demo/TourDemoContext";
import { groupByWorkspace } from "@/lib/workspaceScope";
import {
	listMyTeamInvites,
	listMyTeams,
	type ProfileSummary,
	type Team,
	type TeamInvite,
} from "@/services/teams.service";
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
	// Demo-mode swap sits between the query result and the card-building logic
	// below, so sorting/slicing runs against fixtures exactly as it does against
	// real rows. Returns the real value untouched when no tour is replaying.
	const teams = useTourDemo<Team[]>(
		"teams",
		(teamsQuery.data as Team[] | undefined) ?? [],
	);
	const pendingInvites = useTourDemo<TeamInvite[]>(
		"teamInvites",
		((invitesQuery.data as TeamInvite[] | undefined) ?? []).filter(
			(i) => i.status === "pending",
		),
	);
	const isDemo = useTourDemoActive();
	const isLoading = !isDemo && (teamsQuery.isPending || invitesQuery.isPending);

	const { workspace: currentWorkspace, workspaces } = useCurrentWorkspace();
	const { workspaceSlug } = useParams({ from: "/w/$workspaceSlug" });
	const myWorkspaceIds = useMemo(
		() => workspaces.map((item) => item.id),
		[workspaces],
	);

	// Scoped to the workspace that is open, plus anything reached through
	// project access rather than membership. Teams in the user's OTHER
	// workspaces are left out — they appear on switching. Flattened rather than
	// split into two labelled groups, because this is a three-card preview
	// strip, not the full list the sidebar and /teams render.
	const visibleTeams = useMemo(() => {
		const grouped = groupByWorkspace(
			teams,
			currentWorkspace?.id ?? null,
			myWorkspaceIds,
		);
		return [...grouped.current, ...grouped.shared];
	}, [teams, currentWorkspace?.id, myWorkspaceIds]);

	// Dashboard preview is a single row: pending invites first (they're
	// time-sensitive), then the 3 most recently updated teams. Anything
	// beyond that lives on the /teams page.
	const recentTeams = [...visibleTeams]
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
		<div
			id="my-teams"
			data-tour="dashboard-teams"
			className="app-slide-up scroll-mt-6"
		>
			<div className="mb-4 flex items-end justify-between gap-3">
				<div>
					<div className="flex items-center gap-2">
						<div className="h-3 w-3 rounded-full bg-primary sm:h-[18px] sm:w-[18px]" />
						<h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-[20px]">
							TEAMS
						</h2>
					</div>
					<p className="mt-1 text-xs text-slate-600">
						Reusable groups of people you can attach to any project.
					</p>
				</div>
				<Link
					to="/w/$workspaceSlug/teams"
					params={{ workspaceSlug }}
					className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-slate-700 hover:text-slate-900"
				>
					All teams
					<ArrowRight className="h-3.5 w-3.5" />
				</Link>
			</div>

			<div className="flex flex-col gap-2">
				{isLoading ? (
					<>
						<TeamRowSkeleton />
						<TeamRowSkeleton />
						<TeamRowSkeleton />
					</>
				) : cards.length === 0 ? (
					<TeamsEmptyState />
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
	const { workspaceSlug } = useParams({ from: "/w/$workspaceSlug" });
	const totalMembers = team.members_count ?? 0;
	const previews = (team.members_preview ?? []).filter(
		(p): p is ProfileSummary => Boolean(p),
	);
	const visible = previews.slice(0, AVATAR_PREVIEW_LIMIT);
	const overflow = Math.max(totalMembers - visible.length, 0);

	return (
		<Link
			to="/w/$workspaceSlug/teams/$teamId"
			params={{ workspaceSlug, teamId: team.id }}
			className="group flex items-center gap-3 rounded-xl border border-border bg-(--app-surface-strong) px-4 py-3 text-card-foreground shadow-sm transition-all duration-200 hover:border-(--app-border-strong) hover:bg-muted hover:shadow-md"
		>
			<TeamAvatar team={team} />
			<div className="min-w-0 flex-1">
				<h3 className="truncate text-[13px] font-semibold leading-tight text-card-foreground sm:text-[14px]">
					{team.name || "Untitled team"}
				</h3>
				<TeamCardSubLine team={team} />
			</div>

			<div className="flex shrink-0 items-center gap-3">
				<p className="hidden whitespace-nowrap text-[10px] text-muted-foreground sm:block sm:text-[11px]">
					{totalMembers === 1 ? "1 member" : `${totalMembers} members`}
				</p>
				<AvatarStack members={visible} overflow={overflow} />
				{/* Decorative chevron — hidden on phones to keep the row compact
				    (the whole row is a link). */}
				<span className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-foreground shadow-sm transition-transform duration-200 group-hover:translate-x-0.5 sm:inline-flex">
					<ArrowRight className="h-3 w-3" />
				</span>
			</div>
		</Link>
	);
}

function TeamCardSubLine({ team }: { team: Team }) {
	const role = team.viewer_role;
	const position = team.viewer_position;
	// The column can hold rich HTML since the Overview tab; this is a one-line
	// summary, so it takes the visible text rather than the markup.
	const rawDescription =
		team.description ?? (team.is_personal ? "My team" : null);
	const description = rawDescription ? richTextToPlain(rawDescription) : null;

	const chip = position ? (
		<PositionBadge>{position}</PositionBadge>
	) : role ? (
		<RoleBadge>{role}</RoleBadge>
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
		return (
			<span className="text-[11px] text-muted-foreground">No members</span>
		);
	}
	// Phone rows are too narrow for the full stack, so cap the visible
	// avatars there and roll the rest into the "+N" chip; sm+ shows all.
	const MOBILE_SHOWN = 3;
	const mobileOverflow = Math.max(members.length - MOBILE_SHOWN, 0) + overflow;
	const chipClass =
		"flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-card bg-muted text-[9px] font-semibold text-muted-foreground ring-1 ring-border sm:h-6 sm:w-6";
	return (
		<div className="flex -space-x-1.5">
			{members.map((m, i) => (
				<MemberAvatar
					key={m.id}
					profile={m}
					className={i >= MOBILE_SHOWN ? "max-sm:hidden" : undefined}
				/>
			))}
			{overflow > 0 && (
				<div className={`max-sm:hidden ${chipClass}`}>+{overflow}</div>
			)}
			{mobileOverflow > 0 && (
				<div className={`sm:hidden ${chipClass}`}>+{mobileOverflow}</div>
			)}
		</div>
	);
}

function MemberAvatar({
	profile,
	className,
}: {
	profile: ProfileSummary;
	className?: string;
}) {
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
				className={`h-5 w-5 shrink-0 rounded-full border-2 border-card object-cover ring-1 ring-border sm:h-6 sm:w-6 ${className ?? ""}`}
			/>
		);
	}
	return (
		<div
			title={name}
			className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-card bg-muted text-[9px] font-semibold text-muted-foreground ring-1 ring-border sm:h-6 sm:w-6 ${className ?? ""}`}
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
			className="group flex items-center gap-3 rounded-xl border border-primary bg-primary px-4 py-3 text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md"
		>
			<div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white">
				<span
					aria-hidden="true"
					className="invite-glow-halo pointer-events-none absolute inset-0 rounded-xl bg-white/40 blur-md"
				/>
				<Mail className="invite-glow-icon relative h-5 w-5" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					<h3 className="truncate text-[14px] font-semibold text-white sm:text-[15px]">
						{teamName}
					</h3>
					<span className="hidden shrink-0 items-center rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white sm:inline-flex">
						Pending invite
					</span>
				</div>
				<p className="mt-0.5 truncate text-[12px] text-primary-foreground/80">
					{inviterName} invited you ·{" "}
					{invite.position
						? `${invite.position} (${invite.role})`
						: invite.role}
				</p>
			</div>

			<span className="shrink-0 whitespace-nowrap text-[12px] font-semibold uppercase text-white/80 transition-colors group-hover:text-white sm:text-[13px]">
				Open invite -&gt;
			</span>
		</Link>
	);
}

function TeamsEmptyState({ className }: { className?: string }) {
	const { workspaceSlug } = useParams({ from: "/w/$workspaceSlug" });
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
				Create a team to group the people you collaborate with, then attach the
				team to any project.
			</p>
			<Link
				to="/w/$workspaceSlug/teams"
				params={{ workspaceSlug }}
				className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
			>
				<Plus className="h-4 w-4" />
				Create team
			</Link>
		</div>
	);
}

function TeamRowSkeleton() {
	return (
		<div className="flex items-center gap-3 rounded-xl border border-border bg-(--app-surface-strong) px-4 py-3 shadow-sm">
			<div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-slate-200" />
			<div className="flex-1 space-y-2">
				<div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
				<div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
			</div>
			<div className="h-3 w-16 shrink-0 animate-pulse rounded bg-slate-100" />
		</div>
	);
}
