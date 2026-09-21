import apiClient from "@/api/axios";

/**
 * Recording invoices and payments that happened outside Proyekto.
 *
 * The API is document-first: upload the file, ask for a draft reading of it,
 * then commit an invoice whose figures each carry the region of the page they
 * were read from. See `backend/src/modules/marketplace/finance-imports`.
 */

export type FinanceDocumentKind = "invoice" | "payment_proof" | "other";

export interface ReadField {
	value: string | null;
	/** The reader's own confidence, 0..1. A suggestion, never a fact. */
	confidence: number;
}

export interface FinanceDocument {
	id: string;
	project_id: string;
	kind: FinanceDocumentKind;
	file_name: string;
	mime_type: string;
	size_bytes: number;
	page_count: number | null;
	extraction: {
		fields?: {
			number?: ReadField;
			currency?: ReadField;
			total?: ReadField;
			issue_date?: ReadField;
			due_date?: ReadField;
			client_name?: ReadField;
			note?: string | null;
		};
		note?: string;
		read_at?: string;
	};
	extraction_status: "pending" | "ready" | "failed" | "skipped";
	extraction_error: string | null;
	created_at: string;
}

/** A document plus a short-lived signed URL for rendering it. */
export interface FinanceDocumentWithPreview extends FinanceDocument {
	preview_url: string;
}

export interface DocumentSnip {
	field_key: string;
	document_id: string;
	page: number;
	/** Fractions of the page, so the highlight survives any zoom level. */
	rect: { x: number; y: number; w: number; h: number };
	value_text?: string;
	origin?: "snip" | "extraction" | "manual";
}

export interface ImportedPaymentInput {
	amount: number;
	payment_date: string;
	payment_method?: string;
	reference?: string;
	note?: string;
	settled_currency?: string;
	settled_amount?: number;
	fx_rate?: number;
	proof_document_id?: string;
	snips?: DocumentSnip[];
}

export interface ImportInvoiceInput {
	project_id: string;
	source_document_id: string;
	number: string;
	currency: string;
	total: number;
	issue_date: string;
	due_date?: string;
	notes?: string;
	lines?: Array<{
		description: string;
		quantity?: number;
		unit_rate?: number;
		amount: number;
	}>;
	payments?: ImportedPaymentInput[];
	snips?: DocumentSnip[];
}

export const financeImportsService = {
	/**
	 * Multipart, and deliberately not through the shared `/uploads/file` route:
	 * the row that records what the file IS has to be written in the same call,
	 * or an abandoned upload leaves an orphan in the bucket.
	 */
	async upload(
		projectId: string,
		kind: FinanceDocumentKind,
		file: File,
	): Promise<FinanceDocumentWithPreview> {
		const body = new FormData();
		body.append("file", file);
		body.append("project_id", projectId);
		body.append("kind", kind);
		const { data } = await apiClient.post("/finance-imports/documents", body, {
			headers: { "Content-Type": "multipart/form-data" },
		});
		return data.data as FinanceDocumentWithPreview;
	},

	async list(
		projectId: string,
		kind?: FinanceDocumentKind,
	): Promise<FinanceDocument[]> {
		const { data } = await apiClient.get("/finance-imports/documents", {
			params: { project_id: projectId, kind },
		});
		return data.data as FinanceDocument[];
	},

	async get(documentId: string): Promise<FinanceDocumentWithPreview> {
		const { data } = await apiClient.get(
			`/finance-imports/documents/${documentId}`,
		);
		return data.data as FinanceDocumentWithPreview;
	},

	/**
	 * The document's bytes, for the renderer.
	 *
	 * Read through the API rather than from the presigned URL: pdf.js fetches
	 * what it renders, and a cross-origin read of the private bucket would need
	 * CORS opened on it.
	 */
	async file(documentId: string): Promise<ArrayBuffer> {
		const { data } = await apiClient.get(
			`/finance-imports/documents/${documentId}/file`,
			{ responseType: "arraybuffer" },
		);
		return data as ArrayBuffer;
	},

	/** Draft the fields from the document's text layer. Safe to call again. */
	async read(documentId: string): Promise<FinanceDocument> {
		const { data } = await apiClient.post(
			`/finance-imports/documents/${documentId}/read`,
		);
		return data.data as FinanceDocument;
	},

	async remove(documentId: string): Promise<void> {
		await apiClient.delete(`/finance-imports/documents/${documentId}`);
	},

	async importInvoice(
		input: ImportInvoiceInput,
	): Promise<{ invoice_id: string }> {
		const { data } = await apiClient.post("/finance-imports/invoices", input);
		return data.data as { invoice_id: string };
	},

	async snips(
		invoiceId: string,
	): Promise<Array<DocumentSnip & { id: string; invoice_id: string | null }>> {
		const { data } = await apiClient.get(
			`/finance-imports/invoices/${invoiceId}/snips`,
		);
		return data.data as Array<
			DocumentSnip & { id: string; invoice_id: string | null }
		>;
	},
};
