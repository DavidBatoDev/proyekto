import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

/**
 * Document intake: bring the paper behind work that started outside
 * Proyekto into it. docs/13-proposals/document-intake.md
 */

export type IntakeDocType =
	| "contract"
	| "amendment"
	| "invoice"
	| "receipt"
	| "proof_of_payment"
	| "other";

export type FieldState =
	| "read"
	| "unsure"
	| "needs_input"
	| "corrected"
	| "not_in_document";

export interface ReviewField {
	value: string | null;
	state: FieldState;
	origin: "ai" | "snip" | "typed";
	confidence: number;
	ai_value: string | null;
	page: number | null;
	box: number[] | null;
}

export interface IntakeClause {
	number?: string;
	title?: string;
	body: string;
}

export interface IntakeDocument {
	id: string;
	batch_id: string;
	file_name: string;
	mime_type: string;
	page_count: number;
	page_start: number;
	page_end: number;
	doc_type: IntakeDocType | null;
	language: string | null;
	extraction: {
		clauses?: IntakeClause[];
		line_items?: Array<{
			description?: string;
			quantity?: number | null;
			unit_rate?: number | null;
			amount?: number | null;
		}>;
		match?: { invoice_id: string; basis: string } | null;
		classification_confidence?: number;
	};
	fields: Record<string, ReviewField>;
	flags: string[];
	relationship_id: string | null;
	duplicate_of: string | null;
	status:
		| "uploaded"
		| "classified"
		| "extracted"
		| "confirmed"
		| "replicated"
		| "failed"
		| "skipped";
	replicated_record: Record<string, unknown>;
}

export interface IntakeRelationship {
	id: string;
	counterparty_name: string | null;
	counterparty_email: string | null;
	counterparty_user_id: string | null;
	relationship_kind: "client_services" | "talent_services";
	project_id: string | null;
	project_title: string | null;
	status: "proposed" | "confirmed" | "replicated";
	/**
	 * How the importer is named on this group's documents. `matches` false:
	 * the paper names them `read_name`, not their team `team_name`.
	 */
	party_check?: {
		read_name: string | null;
		team_name: string | null;
		/** The importer's team, to save `read_name` as one of its trading names. */
		team_id?: string | null;
		matches: boolean;
	};
	/**
	 * The documents are in a currency the project is not: the person picks the
	 * project's currency before Import (nothing changes it automatically).
	 */
	currency_question?: {
		document_currencies: string[];
		project_currency: string;
		project_is_new: boolean;
		/** Preselected for a new project; still needs an explicit confirm. */
		suggested: string | null;
	} | null;
	replicated: {
		contract_id?: string;
		project_id?: string;
		/** An agreement held until the counterparty joins (invite first, record on join). */
		pending_agreement?: {
			email: string;
			name: string | null;
			since: string;
			last_error?: string | null;
		} | null;
	};
}

export interface IntakeBatch {
	id: string;
	status: "open" | "replicated" | "abandoned";
	importer_capacity: "consultant" | "client";
	created_at: string;
	documents?: IntakeDocument[];
	relationships?: IntakeRelationship[];
	pages?: number;
}

export interface ReplicateResult {
	project_id: string;
	contract_id: string | null;
	pending_agreement?: IntakeRelationship["replicated"]["pending_agreement"];
	outcomes: Array<{
		document_id: string;
		created?: string;
		error?: string;
		pending?: string;
	}>;
}

function fail(err: unknown, fallback: string): never {
	throw new Error(
		extractApiErrorMessage(
			(err as { response?: { data?: unknown } }).response?.data,
			fallback,
		),
	);
}

async function call<T>(
	run: () => Promise<{ data: { data: T } }>,
	fallback: string,
) {
	try {
		return (await run()).data.data;
	} catch (err) {
		fail(err, fallback);
	}
}

/** Fields the review screen asks for, in reading order, per type. */
export const FIELD_LABELS: Record<string, string> = {
	title: "Title",
	provider_name: "Provider",
	provider_email: "Provider email",
	provider_address: "Provider address",
	provider_tax_id: "Provider tax ID",
	client_name: "Client",
	client_email: "Client email",
	client_address: "Client address",
	client_tax_id: "Client tax ID",
	date_signed: "Date signed",
	service_start: "Service start",
	service_end: "Service end",
	currency: "Currency",
	billing_mode: "Billing mode",
	rate_amount: "Rate",
	billing_timing: "Billing timing",
	payment_terms_days: "Payment terms (days)",
	notice_days: "Notice (days)",
	amends_reference: "Amends",
	effective_date: "Effective date",
	summary_of_changes: "Changes",
	number: "Invoice number",
	issuer: "Issuer",
	recipient: "Recipient",
	issue_date: "Issue date",
	due_date: "Due date",
	subtotal: "Subtotal",
	tax: "Tax",
	total: "Total",
	payer: "Payer",
	payee: "Payee",
	amount: "Amount",
	payment_date: "Payment date",
	reference: "Reference",
	invoice_numbers: "Invoices mentioned",
};

export const DOC_TYPE_LABELS: Record<IntakeDocType, string> = {
	contract: "Contract",
	amendment: "Amendment",
	invoice: "Invoice",
	receipt: "Receipt",
	proof_of_payment: "Proof of payment",
	other: "Other",
};

/** Whether a field still blocks Confirm. */
export function isBlocking(field: ReviewField): boolean {
	return field.state === "unsure" || field.state === "needs_input";
}

export const intakeService = {
	listBatches: () =>
		call<IntakeBatch[]>(
			() => apiClient.get("/api/intake/batches"),
			"Failed to load your imports",
		),
	createBatch: () =>
		call<IntakeBatch>(
			() => apiClient.post("/api/intake/batches", {}),
			"Failed to start an import",
		),
	getBatch: (id: string) =>
		call<IntakeBatch>(
			() => apiClient.get(`/api/intake/batches/${id}`),
			"Failed to load the import",
		),
	upload: (batchId: string, files: File[]) => {
		const body = new FormData();
		for (const file of files) body.append("files", file);
		return call<IntakeDocument[]>(
			() =>
				apiClient.post(`/api/intake/batches/${batchId}/files`, body, {
					headers: { "Content-Type": "multipart/form-data" },
				}),
			"Upload failed",
		);
	},
	classify: (documentId: string) =>
		call<IntakeDocument[]>(
			() => apiClient.post(`/api/intake/documents/${documentId}/classify`),
			"Could not classify the file",
		),
	extract: (documentId: string) =>
		call<IntakeDocument>(
			() => apiClient.post(`/api/intake/documents/${documentId}/extract`),
			"Could not read the document",
		),
	updateDocument: (
		documentId: string,
		patch: {
			doc_type?: IntakeDocType;
			page_start?: number;
			page_end?: number;
			relationship_id?: string | null;
			matched_invoice_id?: string | null;
		},
	) =>
		call<IntakeDocument>(
			() => apiClient.patch(`/api/intake/documents/${documentId}`, patch),
			"Could not update the document",
		),
	updateField: (
		documentId: string,
		patch: {
			field: string;
			value?: string | null;
			accept?: boolean;
			not_in_document?: boolean;
			snip_page?: number;
			snip_box?: number[];
		},
	) =>
		call<IntakeDocument>(
			() =>
				apiClient.patch(`/api/intake/documents/${documentId}/fields`, patch),
			"Could not save the field",
		),
	reread: (
		documentId: string,
		payload: {
			field: string;
			image_data_url: string;
			page?: number;
			box?: number[];
		},
	) =>
		call<IntakeDocument>(
			() =>
				apiClient.post(`/api/intake/documents/${documentId}/reread`, payload),
			"Could not read that region",
		),
	updateClauses: (documentId: string, clauses: IntakeClause[]) =>
		call<IntakeDocument>(
			() =>
				apiClient.patch(`/api/intake/documents/${documentId}/clauses`, {
					clauses,
				}),
			"Could not save the clauses",
		),
	split: (documentId: string, atPage: number) =>
		call<IntakeDocument[]>(
			() =>
				apiClient.post(`/api/intake/documents/${documentId}/split`, {
					at_page: atPage,
				}),
			"Could not split the document",
		),
	confirm: (documentId: string) =>
		call<IntakeDocument>(
			() => apiClient.post(`/api/intake/documents/${documentId}/confirm`),
			"Could not confirm the document",
		),
	group: (batchId: string) =>
		call<IntakeBatch>(
			() => apiClient.post(`/api/intake/batches/${batchId}/group`),
			"Could not group the documents",
		),
	createRelationship: (batchId: string, name?: string) =>
		call<IntakeRelationship>(
			() =>
				apiClient.post(`/api/intake/batches/${batchId}/relationships`, {
					counterparty_name: name,
				}),
			"Could not add the group",
		),
	updateRelationship: (
		id: string,
		patch: {
			counterparty_email?: string;
			counterparty_name?: string;
			relationship_kind?: "client_services" | "talent_services";
			project_id?: string | null;
			project_title?: string;
			confirm?: boolean;
		},
	) =>
		call<IntakeRelationship>(
			() => apiClient.patch(`/api/intake/relationships/${id}`, patch),
			"Could not save the group",
		),
	replicate: (id: string, body: { project_currency?: string } = {}) =>
		call<ReplicateResult>(
			() => apiClient.post(`/api/intake/relationships/${id}/replicate`, body),
			"Could not import this group",
		),
	/** The original file's bytes, for the review pane. */
	async fileBytes(documentId: string): Promise<ArrayBuffer> {
		try {
			const response = await apiClient.get<ArrayBuffer>(
				`/api/intake/documents/${documentId}/file`,
				{ responseType: "arraybuffer" },
			);
			return response.data;
		} catch (err) {
			fail(err, "Could not open the document");
		}
	},
};
