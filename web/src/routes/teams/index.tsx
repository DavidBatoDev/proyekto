import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, Loader2, Plus, User, Users } from "lucide-react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useToast } from "@/hooks/useToast";
import { useAuthStore } from "@/stores/authStore";
import {
	createTeam,
	listMyTeams,
	type ProfileSummary,
	type Team,
} from "@/services/teams.service";

export const Route = createFileRoute("/teams/")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: TeamsIndexPage,
});

function TeamsIndexPage() {
	const { data: teams, isLoading, error } = useQuery({
		queryKey: ["teams", "mine"],
		queryFn: listMyTeams,
	});
	const [createOpen, setCreateOpen] = useState(false);

	return (
		<DashboardShell>
			<div className="mx-auto w-full max-w-[1040px] px-5 py-8 md:px-8 md:py-10">
				<AppSectionHeader
					kicker="Teams"
					title="Your teams"
					subtitle="Reusable groups of people you can attach to any project. Rate / billing fields appear on team members when the team owner is consultant-verified."
					rightSlot={
						teams && teams.length > 0 ? (
							<button
								type="button"
								onClick={() => setCreateOpen(true)}
								className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
							>
								<Plus className="h-4 w-4" />
								Create team
							</button>
						) : undefined
					}
				/>

				<div className="mt-6">
					{isLoading ? (
						<div className="flex items-center justify-center py-16 text-slate-500">
							<Loader2 className="mr-2 h-5 w-5 animate-spin" />
							Loading teams…
						</div>
					) : error ? (
						<AppSurfaceCard className="p-6 text-rose-700">
							{(error as Error).message}
						</AppSurfaceCard>
					) : !teams || teams.length === 0 ? (
						<AppEmptyState
							icon={Users}
							title="No teams yet"
							description="Create a team, add members, then attach the team to a project. Members of the team get curated into projects on a per-project basis."
							action={
								<button
									type="button"
									onClick={() => setCreateOpen(true)}
									className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
								>
									<Plus className="h-4 w-4" />
									Create team
								</button>
							}
						/>
					) : (
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{teams.map((team) => (
								<TeamCard key={team.id} team={team} />
							))}
						</div>
					)}
				</div>
			</div>

			{createOpen && (
				<CreateTeamModal onClose={() => setCreateOpen(false)} />
			)}
		</DashboardShell>
	);
}

const AVATAR_PREVIEW_LIMIT = 6;

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
			className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white hover:shadow-lg"
		>
			<div className="flex items-start gap-2.5">
				{team.avatar_url ? (
					<img
						src={team.avatar_url}
						alt={team.name}
						className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
					/>
				) : (
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors group-hover:bg-slate-900 group-hover:text-white">
						<Users className="h-4.5 w-4.5" />
					</div>
				)}
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-[14px] font-semibold leading-tight text-slate-900">
						{team.name}
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

/**
 * The line under the team name: shows the viewer's position chip (sky)
 * inline with — or in place of — the description / "My team" label.
 * Stays in the natural flow so a long position never overlaps the
 * title. When there's no position we fall back to a slate role chip.
 */
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

function CreateTeamModal({ onClose }: { onClose: () => void }) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	const mutation = useMutation({
		mutationFn: () =>
			createTeam({
				name: name.trim(),
				description: description.trim() || undefined,
			}),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["teams"] });
			toast.success("Team created");
			onClose();
		},
		onError: (err) => {
			toast.error((err as Error).message);
		},
	});

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
			onClick={onClose}
		>
			<div
				className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="text-lg font-semibold text-slate-900">
					Create team
				</h2>
				<p className="mt-1 text-sm text-slate-600">
					Name your team. You'll be added automatically as the owner.
				</p>
				<form
					className="mt-5 space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (!name.trim()) return;
						mutation.mutate();
					}}
				>
					<label className="block">
						<span className="text-sm font-medium text-slate-700">
							Name
						</span>
						<input
							autoFocus
							value={name}
							onChange={(e) => setName(e.target.value)}
							maxLength={120}
							className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
							placeholder="e.g. Engineering Squad"
						/>
					</label>
					<label className="block">
						<span className="text-sm font-medium text-slate-700">
							Description (optional)
						</span>
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							maxLength={500}
							rows={3}
							className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
						/>
					</label>
					<div className="flex justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!name.trim() || mutation.isPending}
							className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
						>
							{mutation.isPending && (
								<Loader2 className="h-4 w-4 animate-spin" />
							)}
							Create
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
