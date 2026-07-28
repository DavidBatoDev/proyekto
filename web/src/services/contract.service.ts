import apiClient from "@/api/axios";
import type {
	BillingMode,
	ContractTermUnit,
	InvoiceCadence,
} from "@/lib/contract-term";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

export type ContractStatus =
	| "draft"
	| "sent"
	| "signed"
	| "active"
	| "ended"
	| "cancelled";

export interface ContractClause {
	key: string;
	title: string;
	body: string;
	position: number;
}

/** A billable service on the contract, reusable as an invoice line item. */
export interface ContractService {
	id: string;
	name: string;
	description?: string;
	unit?: string;
	unit_rate: number;
	position: number;
}

/** A billing window derived from the contract's terms, computed server-side. */
export interface ContractPeriod {
	id: string;
	label: string;
	periodStart: string;
	periodEnd: string;
	invoiceDate: string;
	dueDate: string;
	payDate: string;
}

export interface Contract {
	id: string;
	project_id: string;
	version: number;
	contract_number: string | null;
	status: ContractStatus;

	provider_name: string | null;
	provider_address: string | null;
	provider_tin: string | null;
	provider_email: string | null;
	client_name: string | null;
	client_contact_name: string | null;
	client_address: string | null;
	client_tin: string | null;
	client_email: string | null;
	client_user_id: string | null;

	currency: string;
	billing_mode: BillingMode;
	recurring_fee: number | null;
	/** CLIENT-facing rate. Never a team member's cost rate. */
	client_hourly_rate: number | null;
	included_hours: number | null;
	invoice_cadence: InvoiceCadence;
	period_source: "team_config" | "contract";
	invoice_offset_days: number;
	due_days: number;
	invoice_number_prefix: string | null;
	service_description: string | null;
	payment_method: string | null;

	service_start_date: string | null;
	term_count: number | null;
	term_unit: ContractTermUnit | null;
	service_end_date: string | null;
	contract_end_date: string | null;
	auto_renew: boolean;
	notice_days: number | null;

	clauses: ContractClause[];
	services: ContractService[];
	notes: string | null;
	signed_by_consultant_at: string | null;
	signed_by_consultant_name: string | null;
	signed_by_consultant_signature_url: string | null;
	/** Display multiplier (0.5–3) for the provider signature image. */
	signed_by_consultant_signature_scale: number;
	/** Overlay offsets in base-height multiples; +x right, +y up. */
	signed_by_consultant_signature_offset_x: number;
	signed_by_consultant_signature_offset_y: number;
	signed_by_client_at: string | null;
	signed_by_client_name: string | null;
	signed_by_client_signature_url: string | null;
	/** Display multiplier (0.5–3) for the client signature image. */
	signed_by_client_signature_scale: number;
	signed_by_client_signature_offset_x: number;
	signed_by_client_signature_offset_y: number;

	created_by: string | null;
	created_at: string;
	updated_at: string;

	periods: ContractPeriod[];
}

export interface ContractTermsPayload {
	provider_name?: string;
	provider_address?: string;
	provider_tin?: string;
	provider_email?: string;
	client_name?: string;
	client_contact_name?: string;
	client_address?: string;
	client_tin?: string;
	client_email?: string;
	client_user_id?: string | null;

	currency?: string;
	billing_mode?: BillingMode;
	recurring_fee?: number | null;
	client_hourly_rate?: number | null;
	included_hours?: number | null;
	invoice_cadence?: InvoiceCadence;
	period_source?: "team_config" | "contract";
	invoice_offset_days?: number;
	due_days?: number;
	invoice_number_prefix?: string;
	service_description?: string;
	payment_method?: string;

	service_start_date?: string;
	term_count?: number;
	term_unit?: ContractTermUnit;
	auto_renew?: boolean;
	notice_days?: number | null;
	notes?: string;
	clauses?: ContractClause[];
	services?: ContractService[];
}

export interface ProjectEconomics {
	project_id: string;
	contract_id: string | null;
	currency: string;
	company_percent: number;
	team_percent: number;
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

export interface ActivationChecklistItem {
	key: string;
	label: string;
	ok: boolean;
	severity: "blocker" | "warning";
	detail: string | null;
	fixPath: string | null;
}

export interface ActivationChecklist {
	project_id: string;
	ready: boolean;
	items: ActivationChecklistItem[];
}

function fail(err: unknown, fallback: string): never {
	throw new Error(
		extractApiErrorMessage(
			(err as { response?: { data?: unknown } }).response?.data,
			fallback,
		),
	);
}

/**
 * Where a signature overlay sits on its field. Offsets are in multiples of the
 * base signature height, so one value renders correctly in the compact
 * preview, the full-size document, and the PDF.
 */
export interface SignaturePlacement {
	scale: number;
	offsetX: number;
	offsetY: number;
}

export const DEFAULT_SIGNATURE_PLACEMENT: SignaturePlacement = {
	scale: 1,
	offsetX: 0,
	offsetY: 0,
};

function normalizeContract(contract: Contract): Contract {
	return {
		...contract,
		recurring_fee:
			contract.recurring_fee == null ? null : Number(contract.recurring_fee),
		client_hourly_rate:
			contract.client_hourly_rate == null
				? null
				: Number(contract.client_hourly_rate),
		included_hours:
			contract.included_hours == null ? null : Number(contract.included_hours),
		clauses: [...(contract.clauses ?? [])].sort(
			(a, b) => a.position - b.position,
		),
		services: [...(contract.services ?? [])]
			.map((s) => ({ ...s, unit_rate: Number(s.unit_rate ?? 0) }))
			.sort((a, b) => a.position - b.position),
		// numeric columns can arrive as strings; a missing/0 scale means "base".
		signed_by_consultant_signature_scale:
			Number(contract.signed_by_consultant_signature_scale) || 1,
		signed_by_client_signature_scale:
			Number(contract.signed_by_client_signature_scale) || 1,
		signed_by_consultant_signature_offset_x:
			Number(contract.signed_by_consultant_signature_offset_x) || 0,
		signed_by_consultant_signature_offset_y:
			Number(contract.signed_by_consultant_signature_offset_y) || 0,
		signed_by_client_signature_offset_x:
			Number(contract.signed_by_client_signature_offset_x) || 0,
		signed_by_client_signature_offset_y:
			Number(contract.signed_by_client_signature_offset_y) || 0,
		periods: contract.periods ?? [],
	};
}

export const contractService = {
	async listByProject(projectId: string): Promise<Contract[]> {
		try {
			const { data } = await apiClient.get<{ data: Contract[] }>(
				`/api/contracts/project/${projectId}`,
			);
			return (data.data ?? []).map(normalizeContract);
		} catch (err) {
			fail(err, "Failed to load contracts");
		}
	},

	async create(
		projectId: string,
		payload: ContractTermsPayload,
	): Promise<Contract> {
		try {
			const { data } = await apiClient.post<{ data: Contract }>(
				"/api/contracts",
				{ project_id: projectId, ...payload },
			);
			return normalizeContract(data.data);
		} catch (err) {
			fail(err, "Failed to create the contract");
		}
	},

	async update(
		contractId: string,
		payload: ContractTermsPayload,
	): Promise<Contract> {
		try {
			const { data } = await apiClient.patch<{ data: Contract }>(
				`/api/contracts/${contractId}`,
				payload,
			);
			return normalizeContract(data.data);
		} catch (err) {
			fail(err, "Failed to save the contract");
		}
	},

	async sign(
		contractId: string,
		party: "consultant" | "client",
		signerName: string,
		signatureUrl?: string | null,
		placement?: SignaturePlacement,
	): Promise<Contract> {
		try {
			const { data } = await apiClient.post<{ data: Contract }>(
				`/api/contracts/${contractId}/sign`,
				{
					party,
					signer_name: signerName,
					...(signatureUrl ? { signature_url: signatureUrl } : {}),
					...(placement
						? {
								signature_scale: placement.scale,
								signature_offset_x: placement.offsetX,
								signature_offset_y: placement.offsetY,
							}
						: {}),
				},
			);
			return normalizeContract(data.data);
		} catch (err) {
			fail(err, "Failed to sign the contract");
		}
	},

	/**
	 * Resize or reposition a stamped signature overlay. Cosmetic, so it stays
	 * available after the contract is signed — unlike unsigning. Fields are
	 * independent: send only what changed.
	 */
	async setSignaturePlacement(
		contractId: string,
		party: "consultant" | "client",
		placement: Partial<SignaturePlacement>,
	): Promise<Contract> {
		try {
			const { data } = await apiClient.patch<{ data: Contract }>(
				`/api/contracts/${contractId}/signature-placement`,
				{
					party,
					...(placement.scale !== undefined ? { scale: placement.scale } : {}),
					...(placement.offsetX !== undefined
						? { offset_x: placement.offsetX }
						: {}),
					...(placement.offsetY !== undefined
						? { offset_y: placement.offsetY }
						: {}),
				},
			);
			return normalizeContract(data.data);
		} catch (err) {
			fail(err, "Failed to reposition the signature");
		}
	},

	/** Clear a party's signature so it can be re-done (typed → uploaded, etc.). */
	async unsign(
		contractId: string,
		party: "consultant" | "client",
	): Promise<Contract> {
		try {
			const { data } = await apiClient.post<{ data: Contract }>(
				`/api/contracts/${contractId}/unsign`,
				{ party },
			);
			return normalizeContract(data.data);
		} catch (err) {
			fail(err, "Failed to remove the signature");
		}
	},

	/** Consultant/owner only — a client-role member is rejected server-side. */
	async getEconomics(projectId: string): Promise<ProjectEconomics | null> {
		try {
			const { data } = await apiClient.get<{ data: ProjectEconomics | null }>(
				`/api/projects/${projectId}/economics`,
			);
			if (!data.data) return null;
			return {
				...data.data,
				company_percent: Number(data.data.company_percent ?? 0),
				team_percent: Number(data.data.team_percent ?? 0),
			};
		} catch (err) {
			fail(err, "Failed to load the project budget split");
		}
	},

	async updateEconomics(
		projectId: string,
		payload: {
			company_percent: number;
			team_percent: number;
			currency?: string;
			hour_limits_ack?: boolean;
		},
	): Promise<ProjectEconomics> {
		try {
			const { data } = await apiClient.put<{ data: ProjectEconomics }>(
				`/api/projects/${projectId}/economics`,
				payload,
			);
			return data.data;
		} catch (err) {
			fail(err, "Failed to save the project budget split");
		}
	},

	async getActivationChecklist(
		projectId: string,
	): Promise<ActivationChecklist> {
		try {
			const { data } = await apiClient.get<{ data: ActivationChecklist }>(
				`/api/projects/${projectId}/activation-checklist`,
			);
			return data.data;
		} catch (err) {
			fail(err, "Failed to load the activation checklist");
		}
	},
};
