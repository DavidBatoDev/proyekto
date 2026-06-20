import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
	AlertTriangle,
	FolderKanban,
	Loader2,
	Search,
	Unlink,
} from "lucide-react";
import { TeamSettingsLayout } from "@/components/team/TeamSettingsLayout";
import { useToast } from "@/hooks/useToast";
import { useAuthStore, useUser } from "@/stores/authStore";
import {
	detachTeam,
	getTeam,
	listTeamProjects,
	type TeamProjectAttachment,
} from "@/services/teams.service";
import { ModalPortal } from "@/components/common/ModalPortal";

export const Route = createFileRoute("/teams/$teamId/settings/projects")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: TeamProjectsSettings,
});

function TeamProjectsSettings() {
	const { teamId } = Route.useParams();
	const toast = useToast();
	const user = useUser();
	const queryClient = useQueryClient();

	const teamQuery = useQuery({
		queryKey: ["teams", "detail", teamId],
		queryFn: () => getTeam(teamId),
	});
	const team = teamQuery.data;
	const isOwner = Boolean(team && user && team.owner_id === user.id);

	const projectsQuery = useQuery({
		queryKey: ["teams", "projects", teamId],
		queryFn: () => listTeamProjects(teamId),
	});
	const attachments = projectsQuery.data ?? [];

	const [filter, setFilter] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [confirmOpen, setConfirmOpen] = useState(false);

	const visible = useMemo(() => {
		const q = filter.trim().toLowerCase();
		if (!q) return attachments;
		return attachments.filter((a) =>
			(a.project?.title || "").toLowerCase().includes(q),
		);
	}, [attachments, filter]);

	const toggle = (projectId: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(projectId)) next.delete(projectId);
			else next.add(projectId);
			return next;
		});
	};
	const allVisibleSelected =
		visible.length > 0 && visible.every((a) => selected.has(a.project_id));
	const toggleAllVisible = () => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (allVisibleSelected) {
				for (const a of visible) next.delete(a.project_id);
			} else {
				for (const a of visible) next.add(a.project_id);
			}
			return next;
		});
	};

	const detachMutation = useMutation({
		mutationFn: async (projectIds: string[]) => {
			const results = await Promise.allSettled(
				projectIds.map((pid) => detachTeam(pid, teamId)),
			);
			const failed = results.filter((r) => r.status === "rejected");
			return { ok: results.length - failed.length, failed: failed.length };
		},
		onSuccess: ({ ok, failed }) => {
			void queryClient.invalidateQueries({
				queryKey: ["teams", "projects", teamId],
			});
			setSelected(new Set());
			setConfirmOpen(false);
			if (failed > 0) {
				toast.error(
					`Detached ${ok}; ${failed} failed (you may not have permission on those projects).`,
				);
			} else {
				toast.success(
					ok === 1 ? "Detached from project." : `Detached from ${ok} projects.`,
				);
			}
		},
		onError: (err) => toast.error((err as Error).message),
	});

	if (teamQuery.isLoading) {
		return (
			<TeamSettingsLayout teamId={teamId}>
				<div className="flex h-64 items-center justify-center text-slate-500">
					<Loader2 className="mr-2 h-5 w-5 animate-spin" />
					Loading…
				</div>
			</TeamSettingsLayout>
		);
	}

	return (
		<TeamSettingsLayout teamId={teamId} teamName={team?.name}>
			<div className="space-y-6">
				<section className="space-y-3">
					<div className="flex items-center gap-2">
						<FolderKanban className="h-5 w-5 text-slate-700" />
						<h2 className="text-[30px] font-semibold leading-none text-slate-900">
							Attached projects
						</h2>
					</div>
					<p className="text-sm text-slate-600">
						Projects this team is currently attached to. Detaching here is
						equivalent to removing the team from each project's settings.
					</p>
				</section>

				<div className="app-surface-card-strong overflow-hidden rounded-2xl">
					<header className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
						<div className="relative w-full sm:max-w-xs">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
							<input
								type="text"
								value={filter}
								onChange={(e) => setFilter(e.target.value)}
								placeholder="Filter by project name"
								className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
							/>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-xs text-slate-500">
								{selected.size} selected
							</span>
							<button
								type="button"
								onClick={() => setConfirmOpen(true)}
								disabled={
									!isOwner || selected.size === 0 || detachMutation.isPending
								}
								className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
							>
								<Unlink className="h-3.5 w-3.5" />
								Detach selected
							</button>
						</div>
					</header>

					{projectsQuery.isLoading ? (
						<div className="flex items-center justify-center py-10 text-slate-500">
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Loading attachments…
						</div>
					) : attachments.length === 0 ? (
						<div className="px-5 py-10 text-center text-sm text-slate-500">
							This team isn't attached to any projects yet.
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200 text-sm">
								<thead className="bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
									<tr>
										<th className="w-10 px-4 py-3">
											<input
												type="checkbox"
												checked={allVisibleSelected}
												onChange={toggleAllVisible}
												disabled={!isOwner || visible.length === 0}
												aria-label="Select all visible"
											/>
										</th>
										<th className="px-4 py-3">Project</th>
										<th className="px-4 py-3">Primary</th>
										<th className="px-4 py-3">Attached</th>
										<th className="w-10 px-4 py-3" />
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{visible.map((row) => (
										<TeamProjectRow
											key={row.project_id}
											row={row}
											selected={selected.has(row.project_id)}
											onToggle={() => toggle(row.project_id)}
											isOwner={isOwner}
											onDetachOne={() =>
												detachMutation.mutate([row.project_id])
											}
											pending={detachMutation.isPending}
										/>
									))}
									{visible.length === 0 && filter && (
										<tr>
											<td
												colSpan={6}
												className="px-4 py-8 text-center text-sm text-slate-500"
											>
												No projects match "{filter}".
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</div>

			{confirmOpen && (
				<ModalPortal>
				<div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
					<div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<div className="border-b border-slate-100 bg-rose-50 px-6 py-4">
							<div className="flex items-center gap-2">
								<AlertTriangle className="h-5 w-5 text-rose-600" />
								<h3 className="text-[16px] font-semibold text-rose-700">
									Detach team from {selected.size}{" "}
									{selected.size === 1 ? "project" : "projects"}?
								</h3>
							</div>
							<p className="mt-1 text-sm text-rose-700">
								Members of this team will lose project-level access through
								this attachment. They keep direct project memberships, if any.
							</p>
						</div>
						<div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
							<button
								type="button"
								onClick={() => setConfirmOpen(false)}
								className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
								disabled={detachMutation.isPending}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() =>
									detachMutation.mutate(Array.from(selected.values()))
								}
								disabled={detachMutation.isPending}
								className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
							>
								{detachMutation.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Unlink className="h-4 w-4" />
								)}
								Confirm detach
							</button>
						</div>
					</div>
				</div>
				</ModalPortal>
			)}
		</TeamSettingsLayout>
	);
}

function TeamProjectRow({
	row,
	selected,
	onToggle,
	isOwner,
	onDetachOne,
	pending,
}: {
	row: TeamProjectAttachment;
	selected: boolean;
	onToggle: () => void;
	isOwner: boolean;
	onDetachOne: () => void;
	pending: boolean;
}) {
	const projectId = row.project_id;
	return (
		<tr className="hover:bg-slate-50">
			<td className="px-4 py-3">
				<input
					type="checkbox"
					checked={selected}
					onChange={onToggle}
					disabled={!isOwner}
					aria-label={`Select ${row.project?.title ?? projectId}`}
				/>
			</td>
			<td className="px-4 py-3">
				<Link
					to="/project/$projectId"
					params={{ projectId }}
					className="font-medium text-slate-900 hover:text-slate-700 hover:underline"
				>
					{row.project?.title || projectId}
				</Link>
			</td>
			<td className="px-4 py-3 text-slate-600">
				{row.is_primary ? "Yes" : "—"}
			</td>
			<td className="px-4 py-3 text-slate-600">
				{new Date(row.attached_at).toLocaleDateString()}
			</td>
			<td className="px-4 py-3 text-right">
				<button
					type="button"
					onClick={onDetachOne}
					disabled={!isOwner || pending}
					title="Detach from this project"
					className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
				>
					<Unlink className="h-3.5 w-3.5" />
				</button>
			</td>
		</tr>
	);
}
