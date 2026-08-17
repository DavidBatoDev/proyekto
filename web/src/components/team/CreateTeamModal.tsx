/**
 * Create-team modal for /teams. Lifted out of the route file so the field set
 * can be shared with the onboarding slide via TeamFormFields; the mutation and
 * the close-on-success behaviour stay here, because the deck advances a step
 * instead of closing.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
	EMPTY_TEAM_DRAFT,
	type TeamDraft,
	TeamFormFields,
} from "@/components/team/TeamFormFields";
import { useToast } from "@/hooks/useToast";
import { createTeam } from "@/services/teams.service";

export function CreateTeamModal({ onClose }: { onClose: () => void }) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const [draft, setDraft] = useState<TeamDraft>(EMPTY_TEAM_DRAFT);

	const mutation = useMutation({
		mutationFn: () =>
			createTeam({
				name: draft.name.trim(),
				description: draft.description.trim() || undefined,
				tags: draft.tags,
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
		</ModalPortal>
	);
}
