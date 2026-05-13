import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
	AlertTriangle,
	Edit2,
	Loader2,
	Save,
	Settings,
	Trash2,
	X,
} from "lucide-react";
import { TeamSettingsLayout } from "@/components/team/TeamSettingsLayout";
import { useToast } from "@/hooks/useToast";
import { useAuthStore, useUser } from "@/stores/authStore";
import {
	deleteTeam,
	getTeam,
	updateTeam,
} from "@/services/teams.service";

export const Route = createFileRoute("/teams/$teamId/settings/general")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: TeamGeneralSettings,
});

function TeamGeneralSettings() {
	const { teamId } = Route.useParams();
	const navigate = useNavigate();
	const toast = useToast();
	const user = useUser();
	const queryClient = useQueryClient();

	const teamQuery = useQuery({
		queryKey: ["teams", "detail", teamId],
		queryFn: () => getTeam(teamId),
	});
	const team = teamQuery.data;
	const isOwner = Boolean(team && user && team.owner_id === user.id);

	const [isEditingName, setIsEditingName] = useState(false);
	const [nameDraft, setNameDraft] = useState("");
	const [isEditingDescription, setIsEditingDescription] = useState(false);
	const [descriptionDraft, setDescriptionDraft] = useState("");
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [deleteText, setDeleteText] = useState("");

	useEffect(() => {
		if (team) {
			setNameDraft(team.name || "");
			setDescriptionDraft(team.description ?? "");
		}
	}, [team]);

	const updateMutation = useMutation({
		mutationFn: (patch: { name?: string; description?: string }) =>
			updateTeam(teamId, patch),
		onSuccess: (updated) => {
			queryClient.setQueryData(["teams", "detail", teamId], updated);
			void queryClient.invalidateQueries({ queryKey: ["teams", "mine"] });
			toast.success("Team updated.");
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const deleteMutation = useMutation({
		mutationFn: () => deleteTeam(teamId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["teams"] });
			toast.success("Team deleted.");
			navigate({ to: "/teams" });
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const saveName = async () => {
		const trimmed = nameDraft.trim();
		if (!trimmed) {
			toast.error("Team name cannot be empty.");
			return;
		}
		await updateMutation.mutateAsync({ name: trimmed });
		setIsEditingName(false);
	};

	const saveDescription = async () => {
		await updateMutation.mutateAsync({
			description: descriptionDraft.trim(),
		});
		setIsEditingDescription(false);
	};

	const deleteConfirmMatches =
		deleteText.trim() === (team?.name?.trim() || "");

	if (teamQuery.isLoading) {
		return (
			<TeamSettingsLayout teamId={teamId}>
				<div className="flex h-64 items-center justify-center text-slate-500">
					<Loader2 className="mr-2 h-5 w-5 animate-spin" />
					Loading team…
				</div>
			</TeamSettingsLayout>
		);
	}
	if (teamQuery.error || !team) {
		return (
			<TeamSettingsLayout teamId={teamId}>
				<div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
					{(teamQuery.error as Error)?.message ?? "Failed to load team."}
				</div>
			</TeamSettingsLayout>
		);
	}

	return (
		<TeamSettingsLayout teamId={teamId} teamName={team.name}>
			<div className="space-y-10">
				<section className="space-y-3">
					<div className="flex items-center gap-2">
						<Settings className="h-5 w-5 text-slate-700" />
						<h2 className="text-[30px] font-semibold leading-none text-slate-900">
							General settings
						</h2>
					</div>

					<div className="app-surface-card-strong overflow-hidden rounded-2xl">
						<div className="space-y-7 px-5 py-5">
							<section className="border-b border-slate-200 pb-6">
								<div className="mb-2.5 flex items-center justify-between gap-2">
									<h3 className="text-[18px] font-semibold text-slate-900">
										Team name
									</h3>
									{isOwner && !isEditingName && (
										<button
											type="button"
											onClick={() => setIsEditingName(true)}
											className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900"
										>
											<Edit2 className="h-4 w-4" />
											Edit
										</button>
									)}
								</div>

								{isEditingName ? (
									<div className="space-y-3">
										<input
											type="text"
											value={nameDraft}
											onChange={(e) => setNameDraft(e.target.value)}
											placeholder="Team name"
											disabled={updateMutation.isPending}
											className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
										/>
										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() => void saveName()}
												disabled={updateMutation.isPending}
												className="app-cta inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
											>
												{updateMutation.isPending ? (
													<Loader2 className="h-4 w-4 animate-spin" />
												) : (
													<Save className="h-4 w-4" />
												)}
												Save
											</button>
											<button
												type="button"
												onClick={() => {
													setNameDraft(team.name || "");
													setIsEditingName(false);
												}}
												disabled={updateMutation.isPending}
												className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
											>
												<X className="h-4 w-4" />
												Cancel
											</button>
										</div>
									</div>
								) : (
									<p className="text-[14px] leading-6 text-slate-700">
										{team.name?.trim() || "No name set."}
									</p>
								)}
							</section>

							<section>
								<div className="mb-2.5 flex items-center justify-between gap-2">
									<h3 className="text-[18px] font-semibold text-slate-900">
										Description
									</h3>
									{isOwner && !isEditingDescription && (
										<button
											type="button"
											onClick={() => setIsEditingDescription(true)}
											className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900"
										>
											<Edit2 className="h-4 w-4" />
											Edit
										</button>
									)}
								</div>

								{isEditingDescription ? (
									<div className="space-y-3">
										<textarea
											value={descriptionDraft}
											onChange={(e) => setDescriptionDraft(e.target.value)}
											placeholder="Add a short description"
											rows={4}
											disabled={updateMutation.isPending}
											className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
										/>
										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() => void saveDescription()}
												disabled={updateMutation.isPending}
												className="app-cta inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
											>
												{updateMutation.isPending ? (
													<Loader2 className="h-4 w-4 animate-spin" />
												) : (
													<Save className="h-4 w-4" />
												)}
												Save
											</button>
											<button
												type="button"
												onClick={() => {
													setDescriptionDraft(team.description ?? "");
													setIsEditingDescription(false);
												}}
												disabled={updateMutation.isPending}
												className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
											>
												<X className="h-4 w-4" />
												Cancel
											</button>
										</div>
									</div>
								) : (
									<p className="text-[13px] leading-6 text-slate-600">
										{team.description?.trim() || (
											<span className="text-slate-400">
												No description added yet.
											</span>
										)}
									</p>
								)}
							</section>
						</div>
					</div>
				</section>

				{!isOwner && (
					<div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
						Only the team owner can edit these settings. You're viewing this
						page in read-only mode.
					</div>
				)}

				{isOwner && !team.is_personal && (
					<section className="space-y-3">
						<h2 className="text-[30px] font-semibold leading-none text-slate-900">
							Delete team
						</h2>
						<div className="overflow-hidden rounded-xl border border-red-200 bg-white">
							<header className="flex items-center justify-between border-b border-red-100 bg-red-50 px-5 py-4">
								<p className="text-sm text-red-700">
									Permanently remove this team. Detach it from all projects
									first.
								</p>
								<button
									type="button"
									onClick={() => setIsDeleteOpen(true)}
									className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
								>
									<Trash2 className="h-3.5 w-3.5" />
									Delete team
								</button>
							</header>
							<div className="flex items-start gap-2 px-5 py-4 text-sm text-red-700">
								<AlertTriangle className="mt-0.5 h-4 w-4" />
								Deleting this team cannot be undone.
							</div>
						</div>
					</section>
				)}

				{isOwner && team.is_personal && (
					<section className="space-y-3">
						<h2 className="text-[30px] font-semibold leading-none text-slate-900">
							Personal team
						</h2>
						<div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
							This is your personal team. It can't be deleted.
						</div>
					</section>
				)}
			</div>

			{isDeleteOpen &&
				typeof document !== "undefined" &&
				createPortal(
					<div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
						<div className="w-full max-w-lg overflow-hidden rounded-2xl border border-red-200 bg-white shadow-2xl">
							<div className="border-b border-red-100 bg-red-50 px-6 py-4">
								<h3 className="text-[16px] font-semibold text-red-700">
									Delete team
								</h3>
								<p className="mt-1 text-sm text-red-700">
									Type{" "}
									<span className="font-semibold">{team.name}</span> to
									confirm deletion.
								</p>
							</div>
							<div className="px-6 py-4">
								<input
									type="text"
									value={deleteText}
									onChange={(e) => setDeleteText(e.target.value)}
									className="w-full rounded-lg border border-red-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
									placeholder="Enter team name to confirm"
								/>
							</div>
							<div className="flex items-center justify-end gap-2 border-t border-red-100 bg-red-50/40 px-6 py-4">
								<button
									type="button"
									onClick={() => {
										setIsDeleteOpen(false);
										setDeleteText("");
									}}
									className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
									disabled={deleteMutation.isPending}
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={() => deleteMutation.mutate()}
									disabled={!deleteConfirmMatches || deleteMutation.isPending}
									className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
								>
									{deleteMutation.isPending ? "Deleting…" : "Delete team"}
								</button>
							</div>
						</div>
					</div>,
					document.body
				)}
		</TeamSettingsLayout>
	);
}
