/**
 * Admin Service
 * API calls for the admin dashboard — applications, admin management,
 * matchmaking, plan limits and complimentary workspace plans
 */

import apiClient from "@/api/axios";
import { toServiceError } from "@/lib/planLimitErrors";
import type { PlanId, PlanSource } from "@/lib/planLimits";
import type {
	AdminPlanLimits,
	CompPlan,
	UpdatePlanLimitsInput,
} from "@/lib/planLimitsAdmin";
import type {
	UserCertification,
	UserEducation,
	UserExperience,
	UserIdentityDocument,
	UserLanguage,
	UserLicense,
	UserPortfolio,
	UserRateSettings,
	UserSkill,
	UserSpecialization,
} from "./profile.service";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ApplicationStatus =
	| "draft"
	| "submitted"
	| "under_review"
	| "approved"
	| "rejected";
export type AdminAccessLevel = "support" | "moderator" | "super_admin";
export type ConsultantEnrollmentStatus =
	| "pending"
	| "verified"
	| "suspended"
	| "revoked";

export interface ConsultantApplication {
	id: string;
	user_id: string;
	status: ApplicationStatus;
	cover_letter?: string | null;
	years_of_experience?: number | null;
	primary_niche?: string | null;
	linkedin_url?: string | null;
	website_url?: string | null;
	why_join?: string | null;
	reviewed_by?: string | null;
	reviewed_at?: string | null;
	rejection_reason?: string | null;
	submitted_at?: string | null;
	created_at: string;
	updated_at: string;
	// Joined fields
	applicant?: {
		id: string;
		display_name?: string;
		first_name?: string;
		last_name?: string;
		email: string;
		avatar_url?: string;
		headline?: string;
		consultant_status: ConsultantEnrollmentStatus | null;
		is_consultant_verified: boolean;
	};
	/** Staged taxonomy picks, embedded on both the list and detail reads. */
	placements?: ApplicationPlacementDetail[];
}

export interface ApplicationPlacementDetail {
	subcategory_id: string;
	/** Bucket floor in years (0, 1, 3, 5, 10). */
	years_experience?: number | null;
	is_primary: boolean;
	position: number;
	subcategory: { name: string; slug: string } | null;
}

export interface ApplicationDetail extends ConsultantApplication {
	vetting: {
		skills: UserSkill[];
		languages: UserLanguage[];
		educations: UserEducation[];
		certifications: UserCertification[];
		licenses: UserLicense[];
		experiences: UserExperience[];
		specializations: UserSpecialization[];
		identity_documents: UserIdentityDocument[];
		rate_settings: UserRateSettings | null;
		portfolios: UserPortfolio[];
		placements: ApplicationPlacementDetail[];
	};
}

export interface AdminProfile {
	id: string;
	user_id: string;
	access_level: AdminAccessLevel;
	department?: string | null;
	internal_notes?: string | null;
	is_active: boolean;
	created_at: string;
	user?: {
		id: string;
		display_name?: string;
		email: string;
		avatar_url?: string;
	};
}

export interface MatchCandidate {
	id: string;
	display_name?: string;
	first_name?: string;
	last_name?: string;
	email: string;
	avatar_url?: string;
	headline?: string;
	bio?: string;
	match_score: number;
	rate_settings?: UserRateSettings | null;
	stats?: {
		avg_rating: number;
		jobs_completed: number;
		on_time_rate: number;
	} | null;
	specializations?: UserSpecialization[];
	skills?: UserSkill[];
}

export interface ConsultantProfile {
	id: string;
	display_name?: string;
	first_name?: string;
	last_name?: string;
	email: string;
	avatar_url?: string | null;
	banner_url?: string | null;
	headline?: string | null;
	bio?: string | null;
	phone_number?: string | null;
	country?: string | null;
	city?: string | null;
	is_consultant_verified: boolean;
	consultant_status: ConsultantEnrollmentStatus | null;
	skills: UserSkill[];
	languages: UserLanguage[];
	educations: UserEducation[];
	certifications: UserCertification[];
	licenses: UserLicense[];
	experiences: UserExperience[];
	specializations: UserSpecialization[];
	portfolios: UserPortfolio[];
	rate_settings: UserRateSettings | null;
}

export interface AdminConsultantEnrollment {
	user_id: string;
	status: ConsultantEnrollmentStatus;
	application_id: string | null;
	verified_at: string | null;
	suspended_at: string | null;
	revoked_at: string | null;
	status_reason: string | null;
	status_changed_by: string | null;
	created_at: string;
	updated_at: string;
	profile: {
		id: string;
		display_name?: string | null;
		first_name?: string | null;
		last_name?: string | null;
		email: string;
		avatar_url?: string | null;
		headline?: string | null;
	} | null;
}

// —— Plan limits & workspace plans ——————————————————————————

export type {
	AdminLimitCell,
	AdminLimitKeyMeta,
	AdminPlanLimits,
	CompPlan,
	PlanLimitChange,
	UpdatePlanLimitsInput,
} from "@/lib/planLimitsAdmin";

export type AdminPlanLimitsSaveResult = AdminPlanLimits & {
	/** Tier inversions the save introduced; warned, never blocked. */
	warnings: string[];
};

export type AdminWorkspaceFilter = "all" | "comped" | "paid" | "free";

export interface AdminWorkspaceListParams {
	search?: string;
	filter?: AdminWorkspaceFilter;
	page?: number;
	page_size?: number;
}

export interface AdminWorkspaceRow {
	id: string;
	name: string;
	slug: string;
	created_at: string;
	owner: { id: string; email: string | null } | null;
	members: number;
	pending_invites: number;
	projects: number;
	teams: number;
	/** The raw subscription row: `plan` stays e.g. "pro" after a cancel. */
	subscription: {
		plan: PlanId;
		status: string | null;
		has_provider_subscription: boolean;
	};
	complimentary: {
		plan: CompPlan;
		since: string | null;
		until: string | null;
		active: boolean;
	} | null;
	effective_plan: PlanId;
	plan_source: PlanSource;
	/** Limit keys the workspace is over on its effective plan (grandfathered). */
	over_limit: string[];
}

export interface AdminWorkspacePage {
	items: AdminWorkspaceRow[];
	page: number;
	page_size: number;
	total: number;
}

export interface AdminWorkspaceAuditEntry {
	id: string;
	action: string;
	actor_id: string | null;
	note: string | null;
	before: unknown;
	after: unknown;
	created_at: string;
}

export interface AdminWorkspaceDetail extends AdminWorkspaceRow {
	largest_roadmaps: Array<{
		roadmap_id: string;
		name: string;
		project_id: string | null;
		project_title: string | null;
		owner_id: string;
		nodes: number;
	}>;
	audit: AdminWorkspaceAuditEntry[];
}

export interface SetWorkspaceCompInput {
	plan: CompPlan;
	/** ISO timestamp the comp lapses at; null or absent = never. */
	until?: string | null;
	/** Why, 1..1000 characters. Lands in the admin audit log. */
	note: string;
}

/**
 * An admin API failure that keeps the HTTP status and the server's `code`
 * (e.g. 409 `plan_limits_stale`) next to its readable message.
 */
export class AdminApiError extends Error {
	readonly status: number | null;
	readonly code: string | null;

	constructor(
		message: string,
		status: number | null,
		code: string | null,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = "AdminApiError";
		this.status = status;
		this.code = code;
	}
}

function toAdminApiError(err: unknown, fallback: string): AdminApiError {
	const response = (
		err as { response?: { status?: unknown; data?: unknown } } | null
	)?.response;
	const body = response?.data as
		| { error?: { code?: unknown }; code?: unknown }
		| undefined;
	const code = body?.error?.code ?? body?.code;
	return new AdminApiError(
		toServiceError(err, fallback).message,
		typeof response?.status === "number" ? response.status : null,
		typeof code === "string" ? code : null,
		{ cause: err },
	);
}

// ─── Service ─────────────────────────────────────────────────────────────────

class AdminService {
	private base = "/api/admin";

	// Check if current user is an admin
	async getMe(): Promise<AdminProfile | null> {
		const { data } = await apiClient.get(`${this.base}/me`);
		return data.data;
	}

	// —— Applications —————————————————————————————————————

	async getApplications(
		status?: ApplicationStatus,
	): Promise<ConsultantApplication[]> {
		const params = status ? `?status=${status}` : "";
		const { data } = await apiClient.get(`${this.base}/applications${params}`);
		return data.data ?? [];
	}

	async getApplication(id: string): Promise<ApplicationDetail> {
		const { data } = await apiClient.get(`${this.base}/applications/${id}`);
		return data.data;
	}

	/** Time-limited signed URL to open an applicant's identity document. */
	async getIdentityDocumentUrl(
		applicationId: string,
		documentId: string,
	): Promise<string> {
		const { data } = await apiClient.get(
			`${this.base}/applications/${applicationId}/documents/${documentId}/url`,
		);
		return data.data.url;
	}

	async approveApplication(id: string): Promise<void> {
		await apiClient.post(`${this.base}/applications/${id}/approve`);
	}

	async rejectApplication(id: string, reason?: string): Promise<void> {
		await apiClient.post(`${this.base}/applications/${id}/reject`, { reason });
	}

	async getConsultants(): Promise<AdminConsultantEnrollment[]> {
		const { data } = await apiClient.get(`${this.base}/consultants`);
		return data.data ?? [];
	}

	async suspendConsultant(
		userId: string,
		reason: string,
	): Promise<AdminConsultantEnrollment> {
		const { data } = await apiClient.post(
			`${this.base}/consultants/${userId}/suspend`,
			{ reason },
		);
		return data.data;
	}

	async reinstateConsultant(
		userId: string,
		reason?: string,
	): Promise<AdminConsultantEnrollment> {
		const { data } = await apiClient.post(
			`${this.base}/consultants/${userId}/reinstate`,
			{ reason },
		);
		return data.data;
	}

	async revokeConsultant(
		userId: string,
		reason: string,
	): Promise<AdminConsultantEnrollment> {
		const { data } = await apiClient.post(
			`${this.base}/consultants/${userId}/revoke`,
			{ reason },
		);
		return data.data;
	}

	// —— Admin Management ————————————————————————————————

	async getAdmins(): Promise<AdminProfile[]> {
		const { data } = await apiClient.get(`${this.base}/admins`);
		return data.data ?? [];
	}

	async grantAdmin(
		userId: string,
		payload: { access_level?: AdminAccessLevel; department?: string },
	): Promise<AdminProfile> {
		const { data } = await apiClient.post(
			`${this.base}/admins/${userId}/grant`,
			payload,
		);
		return data.data;
	}

	async revokeAdmin(userId: string): Promise<void> {
		await apiClient.delete(`${this.base}/admins/${userId}/revoke`);
	}

	// —— Matchmaking ——————————————————————————————————————

	async getMatchCandidates(projectId?: string): Promise<MatchCandidate[]> {
		const params = projectId ? `?projectId=${projectId}` : "";
		const { data } = await apiClient.get(
			`${this.base}/match-candidates${params}`,
		);
		return data.data ?? [];
	}

	async getConsultantProfile(consultantId: string): Promise<ConsultantProfile> {
		const { data } = await apiClient.get(
			`${this.base}/consultants/${consultantId}/profile`,
		);
		return data.data;
	}

	async searchConsultants(
		params: {
			q?: string;
			niche?: string;
			availability?: string;
			minRate?: number;
			maxRate?: number;
		} = {},
	): Promise<MatchCandidate[]> {
		const qs = new URLSearchParams();
		if (params.q) qs.set("q", params.q);
		if (params.niche) qs.set("niche", params.niche);
		if (params.availability) qs.set("availability", params.availability);
		if (params.minRate != null) qs.set("minRate", String(params.minRate));
		if (params.maxRate != null) qs.set("maxRate", String(params.maxRate));
		const suffix = qs.toString() ? `?${qs}` : "";
		const { data } = await apiClient.get(
			`${this.base}/match-candidates${suffix}`,
		);
		return data.data ?? [];
	}

	async assignConsultant(
		projectId: string,
		consultantId: string,
	): Promise<void> {
		await apiClient.post(`${this.base}/match-assign`, {
			project_id: projectId,
			consultant_id: consultantId,
		});
	}

	// —— Plan limits ——————————————————————————————————————

	/** The editable limits matrix. Readable by any active admin. */
	async getPlanLimits(): Promise<AdminPlanLimits> {
		try {
			const { data } = await apiClient.get(`${this.base}/plan-limits`);
			return data.data;
		} catch (err) {
			throw toAdminApiError(err, "Couldn't load plan limits.");
		}
	}

	/**
	 * Save every changed cell in one request. A newer save since `base_version`
	 * rejects with an `AdminApiError` whose code is `plan_limits_stale`.
	 */
	async updatePlanLimits(
		input: UpdatePlanLimitsInput,
	): Promise<AdminPlanLimitsSaveResult> {
		try {
			const { data } = await apiClient.put(`${this.base}/plan-limits`, input);
			const result = data.data as AdminPlanLimitsSaveResult;
			return { ...result, warnings: result.warnings ?? [] };
		} catch (err) {
			throw toAdminApiError(err, "Couldn't save plan limits.");
		}
	}

	// —— Workspaces & complimentary plans —————————————————————

	async listWorkspaces(
		params: AdminWorkspaceListParams = {},
	): Promise<AdminWorkspacePage> {
		const qs = new URLSearchParams();
		const search = params.search?.trim();
		if (search) qs.set("search", search);
		if (params.filter && params.filter !== "all") {
			qs.set("filter", params.filter);
		}
		if (params.page) qs.set("page", String(params.page));
		if (params.page_size) qs.set("page_size", String(params.page_size));
		const suffix = qs.toString() ? `?${qs}` : "";
		try {
			const { data } = await apiClient.get(`${this.base}/workspaces${suffix}`);
			const page = data.data as AdminWorkspacePage;
			return { ...page, items: page.items ?? [] };
		} catch (err) {
			throw toAdminApiError(err, "Couldn't load workspaces.");
		}
	}

	async getWorkspace(id: string): Promise<AdminWorkspaceDetail> {
		try {
			const { data } = await apiClient.get(`${this.base}/workspaces/${id}`);
			return data.data;
		} catch (err) {
			throw toAdminApiError(err, "Couldn't load this workspace.");
		}
	}

	/** Grant or edit a complimentary plan. Needs a super admin. */
	async setWorkspaceComp(
		id: string,
		input: SetWorkspaceCompInput,
	): Promise<{ workspace: AdminWorkspaceRow; warnings: string[] }> {
		try {
			const { data } = await apiClient.put(
				`${this.base}/workspaces/${id}/comp`,
				input,
			);
			const result = data.data as {
				workspace: AdminWorkspaceRow;
				warnings?: string[];
			};
			return { workspace: result.workspace, warnings: result.warnings ?? [] };
		} catch (err) {
			throw toAdminApiError(err, "Couldn't save the complimentary plan.");
		}
	}

	/** Remove a complimentary plan (idempotent). Needs a super admin. */
	async clearWorkspaceComp(
		id: string,
		note?: string,
	): Promise<{ workspace: AdminWorkspaceRow }> {
		const trimmed = note?.trim();
		try {
			const { data } = await apiClient.delete(
				`${this.base}/workspaces/${id}/comp`,
				trimmed ? { data: { note: trimmed } } : undefined,
			);
			return data.data;
		} catch (err) {
			throw toAdminApiError(err, "Couldn't remove the complimentary plan.");
		}
	}

	// —— Users ————————————————————————————————————————————

	async getAllUsers(): Promise<any[]> {
		const { data } = await apiClient.get(`${this.base}/users`);
		return data.data ?? [];
	}

	async getAllProjects(): Promise<any[]> {
		const { data } = await apiClient.get(`${this.base}/projects`);
		return data.data ?? [];
	}
}

export const adminService = new AdminService();
