import { apiClient } from "@/api";
import type { AgentContextRefKind, AgentResolvedRef } from "./ai-agent.service";

export interface AiEntityAssignee {
	id: string;
	display_name: string | null;
	avatar_url: string | null;
}

export type AiResolvedEntity = AgentResolvedRef & {
	assignees?: AiEntityAssignee[];
	assignee_count?: number;
};

export interface AiEntityRef {
	kind: AgentContextRefKind;
	id: string;
}

export const aiContextService = {
	async resolveRefs(refs: AiEntityRef[]): Promise<AiResolvedEntity[]> {
		const response = await apiClient.post<{
			data: { refs: AiResolvedEntity[] };
		}>("/api/ai/context/resolve-refs", { refs });
		return response.data.data.refs;
	},
};
