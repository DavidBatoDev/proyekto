import apiClient from "@/api/axios";
import type { ProfileMini } from "@/services/team-time.service";

export type PayoutMethodType = "bank" | "gcash" | "maya" | "paypal" | "other";
export type PayoutStatus = "recorded" | "void";
export type PayoutSource = "batch" | "quick";

export interface PayoutMethod {
	id: string;
	user_id: string;
	method_type: PayoutMethodType;
	label: string | null;
	account_name: string;
	account_identifier: string;
	bank_name: string | null;
	currency: string | null;
	qr_path: string | null;
	/** Short-lived presigned URL for the QR image (null if none). */
	qr_url?: string | null;
	is_default: boolean;
	is_archived: boolean;
	created_at: string;
	updated_at: string;
}

export interface Payout {
	id: string;
	team_id: string;
	member_user_id: string;
	created_by: string;
	payout_method_id: string | null;
	method_type: PayoutMethodType | null;
	method_label: string | null;
	method_account_name: string | null;
	method_account_identifier: string | null;
	method_bank_name: string | null;
	currency: string;
	total_amount: number;
	reference_number: string | null;
	proof_path: string | null;
	note: string | null;
	paid_at: string;
	status: PayoutStatus;
	source: PayoutSource;
	created_at: string;
	updated_at: string;
	member?: ProfileMini | null;
	creator?: Pick<ProfileMini, "id" | "display_name" | "avatar_url"> | null;
}

export interface PayoutDetail extends Payout {
	logs: Array<{
		id: string;
		project_id: string;
		task_id: string | null;
		started_at: string;
		ended_at: string | null;
		duration_seconds: number | null;
		rate_snapshot: number;
		currency_snapshot: string;
		status: string;
		task?: { id: string; title: string | null } | null;
		project?: { id: string; title: string | null } | null;
	}>;
}

export interface CreatePayoutMethodInput {
	method_type: PayoutMethodType;
	label?: string;
	account_name: string;
	account_identifier: string;
	bank_name?: string;
	currency?: string;
	/** Object key from uploadPayoutQr; "" clears the existing QR. */
	qr_path?: string;
	is_default?: boolean;
}

export type UpdatePayoutMethodInput = Partial<CreatePayoutMethodInput>;

/** An outstanding approved-but-unpaid balance for a member in one currency. */
export interface OwedBucket {
	member_user_id: string;
	member: ProfileMini | null;
	currency: string;
	log_count: number;
	hours: number;
	amount: number;
}

export interface CreatePayoutInput {
	team_id: string;
	member_user_id: string;
	log_ids: string[];
	payout_method_id?: string;
	reference_number?: string;
	proof_path?: string;
	note?: string;
	paid_at?: string;
	source?: PayoutSource;
}

type ApiResponse<T> = { data: T };

function extractError(error: unknown, fallback: string): Error {
	const e = error as {
		response?: { data?: { error?: { message?: string }; message?: string } };
		message?: string;
	};
	const message =
		e?.response?.data?.error?.message ||
		e?.response?.data?.message ||
		e?.message ||
		fallback;
	return new Error(message);
}

export const payoutsService = {
	// ─── payout methods (own) ───────────────────────────────────────────
	async listMyMethods(): Promise<PayoutMethod[]> {
		try {
			const res = await apiClient.get<ApiResponse<PayoutMethod[]>>(
				"/api/payout-methods",
			);
			return res.data.data ?? [];
		} catch (e) {
			throw extractError(e, "Failed to load payout methods");
		}
	},

	async createMethod(input: CreatePayoutMethodInput): Promise<PayoutMethod> {
		try {
			const res = await apiClient.post<ApiResponse<PayoutMethod>>(
				"/api/payout-methods",
				input,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to add payout method");
		}
	},

	async updateMethod(
		id: string,
		input: UpdatePayoutMethodInput,
	): Promise<PayoutMethod> {
		try {
			const res = await apiClient.patch<ApiResponse<PayoutMethod>>(
				`/api/payout-methods/${id}`,
				input,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to update payout method");
		}
	},

	async deleteMethod(id: string): Promise<void> {
		try {
			await apiClient.delete(`/api/payout-methods/${id}`);
		} catch (e) {
			throw extractError(e, "Failed to delete payout method");
		}
	},

	async setDefaultMethod(id: string): Promise<PayoutMethod> {
		try {
			const res = await apiClient.post<ApiResponse<PayoutMethod>>(
				`/api/payout-methods/${id}/default`,
				{},
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to set default payout method");
		}
	},

	// ─── payer views a member's methods ─────────────────────────────────
	async listMemberMethods(
		teamId: string,
		memberId: string,
	): Promise<PayoutMethod[]> {
		try {
			const res = await apiClient.get<ApiResponse<PayoutMethod[]>>(
				`/api/payouts/teams/${teamId}/members/${memberId}/payout-methods`,
			);
			return res.data.data ?? [];
		} catch (e) {
			throw extractError(e, "Failed to load member's payout methods");
		}
	},

	// ─── payouts ────────────────────────────────────────────────────────
	async createPayout(input: CreatePayoutInput): Promise<Payout> {
		try {
			const res = await apiClient.post<ApiResponse<Payout>>(
				"/api/payouts",
				input,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to record payout");
		}
	},

	async listTeamPayouts(teamId: string, memberId?: string): Promise<Payout[]> {
		try {
			const res = await apiClient.get<ApiResponse<Payout[]>>(
				`/api/payouts/teams/${teamId}`,
				{ params: memberId ? { member_user_id: memberId } : undefined },
			);
			return res.data.data ?? [];
		} catch (e) {
			throw extractError(e, "Failed to load payouts");
		}
	},

	async getTeamOwed(
		teamId: string,
		range?: { from?: string; to?: string },
	): Promise<OwedBucket[]> {
		try {
			const res = await apiClient.get<ApiResponse<OwedBucket[]>>(
				`/api/payouts/teams/${teamId}/owed`,
				{
					params: {
						from: range?.from || undefined,
						to: range?.to || undefined,
					},
				},
			);
			return res.data.data ?? [];
		} catch (e) {
			throw extractError(e, "Failed to load outstanding balances");
		}
	},

	async getPayout(payoutId: string): Promise<PayoutDetail> {
		try {
			const res = await apiClient.get<ApiResponse<PayoutDetail>>(
				`/api/payouts/${payoutId}`,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to load payout");
		}
	},

	async getProofUrl(payoutId: string): Promise<string> {
		try {
			const res = await apiClient.get<ApiResponse<{ url: string }>>(
				`/api/payouts/${payoutId}/proof-url`,
			);
			return res.data.data.url;
		} catch (e) {
			throw extractError(e, "Failed to load proof");
		}
	},

	async voidPayout(payoutId: string): Promise<Payout> {
		try {
			const res = await apiClient.post<ApiResponse<Payout>>(
				`/api/payouts/${payoutId}/void`,
				{},
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to void payout");
		}
	},
};
