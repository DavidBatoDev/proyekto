import axios from "axios";
import { API_BASE_URL } from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";
import type {
	BillingTiming,
	ContractClause,
	ContractPeriod,
	ContractService,
	ContractStatus,
	ProviderKind,
} from "@/services/contract.service";

/**
 * The public contract-signing API.
 *
 * A bare axios instance, deliberately NOT the shared `apiClient`: these
 * endpoints are reached by a client who has no Proyekto account, so the auth
 * interceptor has no token to attach and its 401 handling would be wrong.
 * Same approach as the roadmap public-share service.
 */
const publicClient = axios.create({
	baseURL: API_BASE_URL,
	headers: { "Content-Type": "application/json" },
});

/**
 * The whitelist the server projects for a signer. Deliberately narrower than
 * `Contract` — no project_id, no created_by, no internal notes.
 */
export interface ContractDocumentView {
	id: string;
	contract_number: string | null;
	status: ContractStatus;
	provider_kind: ProviderKind;
	provider_name: string | null;
	provider_address: string | null;
	provider_tin: string | null;
	provider_email: string | null;
	client_name: string | null;
	client_contact_name: string | null;
	client_address: string | null;
	client_tin: string | null;
	client_email: string | null;
	currency: string;
	billing_mode: "retainer" | "time_based" | "hybrid";
	billing_timing: BillingTiming;
	recurring_fee: number | null;
	client_hourly_rate: number | null;
	included_hours: number | null;
	invoice_cadence: "monthly" | "semi_monthly" | "custom";
	invoice_offset_days: number;
	due_days: number;
	service_description: string | null;
	payment_method: string | null;
	service_start_date: string | null;
	service_end_date: string | null;
	contract_end_date: string | null;
	term_count: number | null;
	term_unit: "month" | "year" | null;
	auto_renew: boolean;
	notice_days: number | null;
	clauses: ContractClause[];
	services: ContractService[];
	signed_by_consultant_at: string | null;
	signed_by_consultant_name: string | null;
	signed_by_consultant_signature_url: string | null;
	signed_by_consultant_signature_scale: number;
	signed_by_consultant_signature_offset_x: number;
	signed_by_consultant_signature_offset_y: number;
	signed_by_client_at: string | null;
	signed_by_client_name: string | null;
	signed_by_client_signature_url: string | null;
	signed_by_client_signature_scale: number;
	signed_by_client_signature_offset_x: number;
	signed_by_client_signature_offset_y: number;
	periods: ContractPeriod[];
	project_title: string | null;
	expires_at: string;
	already_signed: boolean;
}

/** A link that can no longer be used, and why — each reason reads differently. */
export interface SigningLinkProblem {
	/** 410 = expired / used / revoked; 404 = never existed. */
	kind: "gone" | "not_found" | "error";
	message: string;
}

export class SigningLinkError extends Error {
	readonly problem: SigningLinkProblem;
	constructor(problem: SigningLinkProblem) {
		super(problem.message);
		this.problem = problem;
	}
}

function toProblem(err: unknown): SigningLinkError {
	const response = (err as { response?: { status?: number; data?: unknown } })
		.response;
	const message = extractApiErrorMessage(
		response?.data,
		"This signing link could not be opened.",
	);
	if (response?.status === 410) {
		return new SigningLinkError({ kind: "gone", message });
	}
	if (response?.status === 404) {
		return new SigningLinkError({ kind: "not_found", message });
	}
	return new SigningLinkError({ kind: "error", message });
}

export const contractSigningService = {
	async getByToken(token: string): Promise<ContractDocumentView> {
		try {
			const { data } = await publicClient.get<{ data: ContractDocumentView }>(
				`/api/contracts/sign/${token}`,
			);
			return data.data;
		} catch (err) {
			throw toProblem(err);
		}
	},

	async sign(
		token: string,
		payload: {
			signer_name: string;
			/** `data:image/png;base64,...` — omit for a typed-name-only signature. */
			signature_png?: string;
		},
	): Promise<ContractDocumentView> {
		try {
			const { data } = await publicClient.post<{ data: ContractDocumentView }>(
				`/api/contracts/sign/${token}`,
				payload,
			);
			return data.data;
		} catch (err) {
			throw toProblem(err);
		}
	},
};

/** Consultant-side link management. Goes through the authenticated client. */
export interface SignatureLinkSummary {
	id: string;
	url: string;
	expires_at: string;
	recipient_email: string | null;
	view_count: number;
	last_viewed_at: string | null;
	used_at: string | null;
	/**
	 * Present only on the create response, and only when an email was asked
	 * for. Same shape as `InvoiceWithLines.email_delivery` — report from this,
	 * never from the local "send email" checkbox, or a failed send gets toasted
	 * as a success.
	 */
	email_delivery?: { sent: boolean; reason?: string; to?: string };
}
