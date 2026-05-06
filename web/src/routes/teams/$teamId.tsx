import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
	ArrowLeft,
	Loader2,
	Plus,
	Trash2,
	User,
	Users,
} from "lucide-react";
import { AppSectionHeader, AppSurfaceCard } from "@/components/common/AppPrimitives";
import { useToast } from "@/hooks/useToast";
import { useUser } from "@/stores/authStore";
import {
	addTeamMember,
	getTeam,
	listTeamMembers,
	removeTeamMember,
	type TeamMember,
} from "@/services/teams.service";

export const Route = createFileRoute("/teams/$teamId")({
	component: TeamDetailPage,
});

function TeamDetailPage() {
	const { teamId } = Route.useParams();
	const user = useUser();
	const teamQuery = useQuery({
		queryKey: ["teams", "detail", teamId],
		queryFn: () => getTeam(teamId),
	});
	const membersQuery = useQuery({
		queryKey: ["teams", "members", teamId],
		queryFn: () => listTeamMembers(teamId),
	});

	const team = teamQuery.data;
	const members = membersQuery.data ?? [];
	const isOwner = team && user && team.owner_id === user.id;
	const [addOpen, setAddOpen] = useState(false);

	if (teamQuery.isLoading) {
		return (
			<div className="flex h-64 items-center justify-center text-slate-500">
				<Loader2 className="mr-2 h-5 w-5 animate-spin" />
				Loading team…
			</div>
		);
	}
	if (teamQuery.error) {
		return (
			<AppSurfaceCard className="m-8 p-6 text-rose-700">
				{(teamQuery.error as Error).message}
			</AppSurfaceCard>
		);
	}
	if (!team) return null;

	return (
		<div className="app-shell-bg min-h-full">
			<div className="mx-auto w-full max-w-[1040px] px-5 py-8 md:px-8 md:py-10">
				<Link
					to="/teams"
					className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
				>
					<ArrowLeft className="h-4 w-4" />
					All teams
				</Link>

				<AppSectionHeader
					kicker="Team"
					title={team.name}
					subtitle={team.description ?? undefined}
				/>

				<div className="mt-8">
					<div className="mb-3 flex items-center justify-between">
						<h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
							Members ({members.length})
						</h3>
						{isOwner && (
							<button
								type="button"
								onClick={() => setAddOpen(true)}
								className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
							>
								<Plus className="h-4 w-4" />
								Add member
							</button>
						)}
					</div>
					<AppSurfaceCard className="overflow-hidden">
						{membersQuery.isLoading ? (
							<div className="flex items-center justify-center py-10 text-slate-500">
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Loading…
							</div>
						) : members.length === 0 ? (
							<div className="px-6 py-10 text-center text-sm text-slate-500">
								No members yet.
							</div>
						) : (
							<ul className="divide-y divide-slate-200">
								{members.map((m) => (
									<MemberRow
										key={m.id}
										member={m}
										teamId={teamId}
										isOwnerView={Boolean(isOwner)}
										ownerId={team.owner_id}
									/>
								))}
							</ul>
						)}
					</AppSurfaceCard>
				</div>
			</div>

			{addOpen && (
				<AddMemberModal
					teamId={teamId}
					onClose={() => setAddOpen(false)}
				/>
			)}
		</div>
	);
}

function MemberRow({
	member,
	teamId,
	isOwnerView,
	ownerId,
}: {
	member: TeamMember;
	teamId: string;
	isOwnerView: boolean;
	ownerId: string;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const isOwnerRow = member.user_id === ownerId;

	const removeMutation = useMutation({
		mutationFn: () => removeTeamMember(teamId, member.user_id),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["teams", "members", teamId],
			});
			toast.success("Member removed");
		},
		onError: (err) => toast.error((err as Error).message),
	});

	return (
		<li className="flex items-center justify-between px-5 py-3">
			<div className="flex items-center gap-3">
				<div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">
					<User className="h-4 w-4" />
				</div>
				<div>
					<p className="text-sm font-medium text-slate-900">
						{member.user_id}
					</p>
					<p className="text-xs uppercase tracking-wide text-slate-500">
						{member.role}
					</p>
				</div>
			</div>
			{isOwnerView && !isOwnerRow && (
				<button
					type="button"
					onClick={() => removeMutation.mutate()}
					disabled={removeMutation.isPending}
					className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
				>
					{removeMutation.isPending ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<Trash2 className="h-3.5 w-3.5" />
					)}
					Remove
				</button>
			)}
		</li>
	);
}

function AddMemberModal({
	teamId,
	onClose,
}: {
	teamId: string;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const [userId, setUserId] = useState("");

	const mutation = useMutation({
		mutationFn: () => addTeamMember(teamId, { user_id: userId.trim() }),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["teams", "members", teamId],
			});
			toast.success("Member added");
			onClose();
		},
		onError: (err) => toast.error((err as Error).message),
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
				<div className="mb-1 flex items-center gap-2">
					<Users className="h-5 w-5 text-slate-700" />
					<h2 className="text-lg font-semibold text-slate-900">
						Add team member
					</h2>
				</div>
				<p className="mt-1 text-sm text-slate-600">
					Paste the user's profile ID. (A proper picker is coming.)
				</p>
				<form
					className="mt-5 space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (!userId.trim()) return;
						mutation.mutate();
					}}
				>
					<label className="block">
						<span className="text-sm font-medium text-slate-700">
							User ID
						</span>
						<input
							autoFocus
							value={userId}
							onChange={(e) => setUserId(e.target.value)}
							placeholder="00000000-0000-0000-0000-000000000000"
							className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-slate-900 focus:outline-none"
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
							disabled={!userId.trim() || mutation.isPending}
							className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
						>
							{mutation.isPending && (
								<Loader2 className="h-4 w-4 animate-spin" />
							)}
							Add
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
