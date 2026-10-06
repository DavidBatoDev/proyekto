import { useQuery } from "@tanstack/react-query";
import { engagementService } from "@/services/engagement.service";

/**
 * The caller's active client agreements linked to a project, as a party sees
 * them (`GET /engagements?kind=client_services&status=active&project_id=`).
 * The API scopes by seat, so a non-party gets an empty list, never an error.
 * Keyed under `["engagements", …]`, so any engagement write refreshes it.
 */
export function projectClientAgreementsKey(projectId: string) {
	return ["engagements", "project-client", projectId] as const;
}

export function useProjectClientAgreements(projectId: string, enabled = true) {
	return useQuery({
		queryKey: projectClientAgreementsKey(projectId),
		queryFn: () =>
			engagementService.list({
				kind: "client_services",
				status: "active",
				project_id: projectId,
			}),
		enabled: enabled && Boolean(projectId),
		staleTime: 60_000,
		retry: 1,
	});
}
