/**
 * Create-team modal for /teams. Lifted out of the route file so the field set
 * can be shared with the onboarding slide via TeamFormFields; the mutation and
 * the close-on-success behaviour stay here, because the deck advances a step
 * instead of closing.
 *
 * A refusal at the workspace's team cap keeps the modal open with the limit
 * stated in place, so the typed name survives an upgrade in another tab.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { PlanLimitNotice } from "@/components/billing/PlanLimitNotice";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
	EMPTY_TEAM_DRAFT,
	type TeamDraft,
	TeamFormFields,
} from "@/components/team/TeamFormFields";
import { useToast } from "@/hooks/useToast";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { type PlanLimitInfo, parsePlanLimitError } from "@/lib/planLimitErrors";
import { workspaceKeys } from "@/queries/workspaces";
import { createTeam } from "@/services/teams.service";
import { getCurrentWorkspaceId } from "@/stores/workspaceStore";

export function CreateTeamModal({ onClose }: { onClose: () => void }) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const [draft, setDraft] = useState<TeamDraft>(EMPTY_TEAM_DRAFT);
	const [planLimit, setPlanLimit] = useState<PlanLimitInfo | null>(null);
	const { workspace: currentWorkspace, workspaces } = useCurrentWorkspace();
	const limitWorkspace =
		(planLimit?.workspaceId
			? workspaces.find((item) => item.id === planLimit.workspaceId)
			: null) ?? currentWorkspace;

	const mutation = useMutation({
		mutationFn: () =>
			createTeam({
				name: draft.name.trim(),
				description: draft.description.trim() || undefined,
				tags: draft.tags,
				// Omitted when no workspace is selected yet; the backend then uses
				// the caller's default workspace.
				workspace_id: getCurrentWorkspaceId() ?? undefined,
			}),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["teams"] });
			// The team meter moved; the workspace may have been the default one,
			// so refresh every workspace's usage rather than guess which.
			void queryClient.invalidateQueries({ queryKey: workspaceKeys.usageAll });
			toast.success("Team created");
			onClose();
		},
		onError: (err) => {
			const info = parsePlanLimitError(err);
			if (info) {
				// Stated in the modal; the upgrade prompt is already on screen.
				setPlanLimit(info);
				return;
			}
			toast.error((err as Error).message);
		},
	});

	return (
		<ModalPortal>
			<div
				className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
				onClick={onClose}
			>
				<div
					className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
					onClick={(e) => e.stopPropagation()}
				>
					<h2 className="text-lg font-semibold text-slate-900">Create team</h2>
					<p className="mt-1 text-sm text-slate-600">
						Name your team. You'll be added automatically as the owner.
					</p>
					<form
						className="mt-5 space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (!draft.name.trim()) return;
							setPlanLimit(null);
							mutation.mutate();
						}}
					>
						<TeamFormFields
							draft={draft}
							onChange={setDraft}
							disabled={mutation.isPending}
							autoFocus
							variant="modal"
						/>
						{planLimit ? (
							<PlanLimitNotice
								info={planLimit}
								workspace={limitWorkspace}
								variant="inline"
							/>
						) : null}
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
								disabled={!draft.name.trim() || mutation.isPending}
								className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
		</ModalPortal>
	);
}
