import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateTeamEverywhere } from "@/hooks/dashboardInvalidation";
import { useToast } from "@/hooks/useToast";
import { teamKeys } from "@/queries/teams";
import {
	type Team,
	type UpdateTeamPatch,
	updateTeam,
} from "@/services/teams.service";

/**
 * One team-patch mutation, instantiated per field.
 *
 * Each Overview field calls this for itself, so each gets its own `isPending`.
 * The settings page shares a single mutation across five blocks, which means
 * uploading an avatar visibly disables the name, description and tag editors at
 * the same time; that is the flaw this shape exists to avoid.
 *
 * Writes are optimistic and merge only the keys actually patched. A full-row
 * `setQueryData(updated)` on success would be wrong here precisely because the
 * fields are independent: with two patches in flight, the slower response would
 * carry a stale copy of the field the faster one just changed and quietly
 * revert it.
 */
export function useTeamPatch(teamId: string) {
	const queryClient = useQueryClient();
	const toast = useToast();

	return useMutation({
		mutationFn: (patch: UpdateTeamPatch) => updateTeam(teamId, patch),

		onMutate: async (patch) => {
			await queryClient.cancelQueries({ queryKey: teamKeys.detail(teamId) });
			const previous = queryClient.getQueryData<Team>(teamKeys.detail(teamId));
			if (previous) {
				queryClient.setQueryData<Team>(teamKeys.detail(teamId), {
					...previous,
					...patch,
				});
			}
			return { previous };
		},

		onError: (err, _patch, context) => {
			if (context?.previous) {
				queryClient.setQueryData(teamKeys.detail(teamId), context.previous);
			}
			toast.error((err as Error).message);
		},

		// Both key families, so a rename does not leave a stale name on the
		// /teams/:id/time/* pages.
		onSettled: () => invalidateTeamEverywhere(queryClient, teamId),
	});
}
