import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Plus, Users } from "lucide-react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { useToast } from "@/hooks/useToast";
import { createTeam, listMyTeams, type Team } from "@/services/teams.service";

export const Route = createFileRoute("/teams/")({
	component: TeamsIndexPage,
});

function TeamsIndexPage() {
	const { data: teams, isLoading, error } = useQuery({
		queryKey: ["teams", "mine"],
		queryFn: listMyTeams,
	});
	const [createOpen, setCreateOpen] = useState(false);

	return (
		<div className="app-shell-bg min-h-full">
			<div className="mx-auto w-full max-w-[1040px] px-5 py-8 md:px-8 md:py-10">
				<AppSectionHeader
					kicker="Teams"
					title="Your teams"
					subtitle="Reusable groups of people you can attach to any project. Rate / billing fields appear on team members when the team owner is consultant-verified."
					rightSlot={
						<button
							type="button"
							onClick={() => setCreateOpen(true)}
							className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
						>
							<Plus className="h-4 w-4" />
							Create team
						</button>
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
						<div className="grid gap-4 sm:grid-cols-2">
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
		</div>
	);
}

function TeamCard({ team }: { team: Team }) {
	return (
		<Link
			to="/teams/$teamId"
			params={{ teamId: team.id }}
			className="block"
		>
			<AppSurfaceCard className="h-full p-5 transition hover:border-slate-300 hover:shadow-md">
				<div className="flex items-start gap-3">
					<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
						<Users className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<h3 className="truncate text-base font-semibold text-slate-900">
							{team.name}
						</h3>
						{team.description && (
							<p className="mt-1 line-clamp-2 text-sm text-slate-600">
								{team.description}
							</p>
						)}
					</div>
				</div>
			</AppSurfaceCard>
		</Link>
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
