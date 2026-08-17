import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

export type EngagementKind = "client_services" | "talent_services";
export type EngagementStatus = "active" | "ended" | "cancelled";
export type EngagementPosition = "hirer" | "provider";

export interface EngagementParty {
	position: EngagementPosition;
	user_id: string;
	capacity: string;
	display_name_snapshot: string | null;
	email_snapshot: string | null;
}

export interface EngagementProjectLink {
	id: string;
	project_id: string | null;
	project_title_snapshot: string;
	basis: string;
	status: string;
	linked_at: string | null;
	ended_at: string | null;
}

export interface EngagementTimeSettings {
	id: string;
	tracking_mode: string;
	approval_mode: string;
	allow_manual_entries: boolean;
	rounding_minutes: number;
	weekly_limit_minutes: number | null;
	client_hours_detail_level: string;
	effective_from: string;
	effective_until: string | null;
}

export interface EngagementTimeRate {
	id: string;
	worker_user_id: string | null;
	rate_kind: "billing" | "cost";
	unit: "hour" | "month" | "fixed";
	work_type: string | null;
	amount: number;
	currency: string | null;
	effective_from: string;
	effective_until: string | null;
}

/**
 * An engagement as the signed-in party may see it. The API scopes by party
 * membership, so `counterparty` is always the other seat — a Client never
 * receives the Talent engagement, its identities, or its `cost` rates.
 */
export interface Engagement {
	id: string;
	kind: EngagementKind;
	scope_mode: "project_specific" | "flexible";
	status: EngagementStatus;
	origin: string | null;
	activated_by_contract_id: string | null;
	started_at: string | null;
	ended_at: string | null;
	cancelled_at: string | null;
	status_reason: string | null;
	viewer_position: EngagementPosition;
	viewer_capacity: string;
	counterparty: EngagementParty | null;
	project_links: EngagementProjectLink[];
	current_settings: EngagementTimeSettings | null;
	current_rates: EngagementTimeRate[];
}

export interface EngagementFilters {
	kind?: EngagementKind;
	status?: EngagementStatus;
	project_id?: string;
}

async function get<T>(path: string, params?: object): Promise<T> {
	try {
		const { data } = await apiClient.get<{ data: T }>(path, { params });
		return data.data;
	} catch (error) {
		throw new Error(
			extractApiErrorMessage(
				(error as { response?: { data?: unknown } }).response?.data,
				"Failed to load engagements",
			),
		);
	}
}

export const engagementService = {
	list: (filters: EngagementFilters = {}) =>
		get<Engagement[]>("/api/engagements", filters),
	byId: (id: string) => get<Engagement>(`/api/engagements/${id}`),
};
