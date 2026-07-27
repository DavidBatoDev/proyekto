import { useQuery } from "@tanstack/react-query";
import {
	type ActivationChecklist,
	contractService,
} from "@/services/contract.service";

/**
 * The project's activation checklist, shared by every surface that shows the
 * "make it live" guide (header pill, Overview widget, Contract tab). Disabled
 * once the project is active (nothing left to guide) or when the caller can't
 * manage the project — the endpoint is admin-gated, so a non-admin would just
 * 403.
 */
export function useActivationChecklist(
	projectId: string,
	options?: { enabled?: boolean },
) {
	return useQuery<ActivationChecklist>({
		queryKey: ["project", projectId, "activation-checklist"],
		queryFn: () => contractService.getActivationChecklist(projectId),
		enabled: options?.enabled ?? true,
		// The guide is glanceable, not real-time; a short stale window avoids a
		// refetch storm as the consultant fixes items across sections.
		staleTime: 15_000,
	});
}
