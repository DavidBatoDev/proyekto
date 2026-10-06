import apiClient from "@/api/axios";
import { toTimeApiError } from "@/services/time.service";

export type PayoutMethodType = "bank" | "gcash" | "maya" | "paypal" | "other";
export type PayoutStatus = "recorded" | "void";
export type PayoutSource = "batch" | "quick";

/** The profile embed on payout and owed rows. */
export interface ProfileMini {
	id: string;
	display_name: string | null;
	avatar_url: string | null;
	first_name?: string | null;
	last_name?: string | null;
	email?: string | null;
}

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

/** One time entry a payout paid (`GET /payouts/:id`). */
export interface PayoutEntry {
	id: string;
	project_id: string | null;
	task_id: string | null;
	started_at: string;
	ended_at: string | null;
	duration_seconds: number | null;
	/** Approved (frozen) time; what the payout total is computed from. */
	payable_seconds?: number | null;
	rate_snapshot: number;
	rate_type_snapshot?: "hourly" | "fixed" | null;
	currency_snapshot: string;
	/** Always "paid": every entry still pointing at the payout is paid by it. */
	status?: string;
	task?: { id: string; title: string | null } | null;
	project?: { id: string; title: string | null } | null;
}

export interface PayoutDetail extends Payout {
	/** The entries this payout paid (D37 adds this name). */
	entries?: PayoutEntry[];
	/** The same rows under their old name, still sent (D37). */
	logs?: PayoutEntry[];
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

/**
 * A member's Owed balance in one currency: approved team time with no payment
 * and no legacy marker, fixed-rate time left out (it is paid by hand). The
 * amount is rounded once on the sum, as the payment itself is.
 */
export interface OwedBucket {
	member_user_id: string;
	member: ProfileMini | null;
	currency: string;
	/** The old name of `entry_count`, still sent (D37). */
	log_count: number;
	entry_count?: number;
	hours: number;
	amount: number;
}

export interface CreatePayoutInput {
	team_id: string;
	member_user_id: string;
	/** The time entries paid: all Owed, one member, one currency. */
	entry_ids: string[];
	payout_method_id?: string;
	reference_number?: string;
	proof_path?: string;
	note?: string;
	paid_at?: string;
	source?: PayoutSource;
}

/** Local dates (`YYYY-MM-DD`) in the team's time zone, both inclusive. */
export interface OwedRange {
	from?: string;
	until?: string;
}

type ApiResponse<T> = { data: T };

/** The entries of a payout detail, whichever name the server sent. */
export function payoutEntries(detail: PayoutDetail): PayoutEntry[] {
	return detail.entries ?? detail.logs ?? [];
}

/** Payout-method errors keep their old plain shape (the profile pages read `.message`). */
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

/**
 * Payout errors keep their status and code (`PAYOUT_SELF_NOT_ALLOWED`,
 * `FIXED_RATE_NOT_PAYABLE_BY_ENTRY`, `plan_limit`, 404s), so the money pages
 * word them through `lib/timeErrors` and `FinanceQueryError` can tell a
 * refusal from a failure. A `TimeApiError` is still an `Error` with the
 * server's sentence as its message.
 */
function payoutError(error: unknown): Error {
	return toTimeApiError(error);
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
				`/api/payouts/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}/payout-methods`,
			);
			return res.data.data ?? [];
		} catch (e) {
			throw payoutError(e);
		}
	},

	// ─── payouts ────────────────────────────────────────────────────────
	async createPayout(input: CreatePayoutInput): Promise<Payout> {
		try {
			// Only the DTO's keys: the backend refuses unknown ones.
			const body: CreatePayoutInput = {
				team_id: input.team_id,
				member_user_id: input.member_user_id,
				entry_ids: Array.from(new Set(input.entry_ids)),
				payout_method_id: input.payout_method_id || undefined,
				reference_number: input.reference_number || undefined,
				proof_path: input.proof_path || undefined,
				note: input.note || undefined,
				paid_at: input.paid_at || undefined,
				source: input.source,
			};
			const res = await apiClient.post<ApiResponse<Payout>>(
				"/api/payouts",
				body,
			);
			return res.data.data;
		} catch (e) {
			throw payoutError(e);
		}
	},

	async listTeamPayouts(teamId: string, memberId?: string): Promise<Payout[]> {
		try {
			const res = await apiClient.get<ApiResponse<Payout[]>>(
				`/api/payouts/teams/${encodeURIComponent(teamId)}`,
				{ params: memberId ? { member_user_id: memberId } : undefined },
			);
			return res.data.data ?? [];
		} catch (e) {
			throw payoutError(e);
		}
	},

	/** Needs `time_payouts` on the team's plan (a `plan_limit` 403 otherwise). */
	async getTeamOwed(teamId: string, range?: OwedRange): Promise<OwedBucket[]> {
		try {
			const res = await apiClient.get<ApiResponse<OwedBucket[]>>(
				`/api/payouts/teams/${encodeURIComponent(teamId)}/owed`,
				{
					params: {
						from: range?.from || undefined,
						until: range?.until || undefined,
					},
				},
			);
			return res.data.data ?? [];
		} catch (e) {
			throw payoutError(e);
		}
	},

	async getPayout(payoutId: string): Promise<PayoutDetail> {
		try {
			const res = await apiClient.get<ApiResponse<PayoutDetail>>(
				`/api/payouts/${encodeURIComponent(payoutId)}`,
			);
			return res.data.data;
		} catch (e) {
			throw payoutError(e);
		}
	},

	async getProofUrl(payoutId: string): Promise<string> {
		try {
			const res = await apiClient.get<ApiResponse<{ url: string }>>(
				`/api/payouts/${encodeURIComponent(payoutId)}/proof-url`,
			);
			return res.data.data.url;
		} catch (e) {
			throw payoutError(e);
		}
	},

	async voidPayout(payoutId: string): Promise<Payout> {
		try {
			const res = await apiClient.post<ApiResponse<Payout>>(
				`/api/payouts/${encodeURIComponent(payoutId)}/void`,
				{},
			);
			return res.data.data;
		} catch (e) {
			throw payoutError(e);
		}
	},
};
