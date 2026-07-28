import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

export type InvoiceStatus = "draft" | "issued" | "sent" | "paid" | "void";

export interface InvoiceLineItemInput {
	description: string;
	quantity: number;
	unit_rate: number;
}

export interface InvoiceLineItem {
	id: string;
	invoice_id: string;
	source_type: "manual" | "time_log" | "retainer" | "overage";
	source_log_id: string | null;
	description: string;
	quantity: number;
	unit_rate: number;
	amount: number;
	metadata: Record<string, unknown>;
	position: number;
	created_at: string;
	updated_at: string;
}

export interface InvoiceDocument {
	id: string;
	invoice_id: string;
	kind: "pdf";
	storage_path: string;
	created_by: string | null;
	created_at: string;
}

export type InvoiceOrigin = "manual" | "scheduled";
/** How much time detail the CLIENT is shown. Never reveals member identity or cost. */
export type HoursDetailLevel = "none" | "summary" | "detailed";

export interface InvoiceParty {
	name?: string | null;
	address?: string | null;
	tin?: string | null;
	email?: string | null;
}

export interface Invoice {
	id: string;
	project_id: string;
	contract_id: string | null;
	issuer_user_id: string;
	recipient_user_id: string | null;
	number: string;
	status: InvoiceStatus;
	currency: string;
	issue_date: string | null;
	due_date: string | null;
	period_start: string | null;
	period_end: string | null;
	origin: InvoiceOrigin;
	hours_detail_level: HoursDetailLevel;
	bill_to: InvoiceParty;
	issued_by: InvoiceParty;
	payment_method: string | null;
	notes: string | null;
	attach_hours: boolean;
	subtotal: number;
	total: number;
	issued_at: string | null;
	sent_at: string | null;
	paid_at: string | null;
	voided_at: string | null;
	pdf_path: string | null;
	created_at: string;
	updated_at: string;
	line_items: InvoiceLineItem[];
	documents: InvoiceDocument[];
	/** Present on the issue/resend responses only. */
	email_delivery?: InvoiceEmailDelivery;
}

export interface InvoiceListResult {
	items: Invoice[];
	total: number;
}

/** Outcome of emailing an invoice to the client. */
export interface InvoiceEmailDelivery {
	sent: boolean;
	/** Why it didn't send. Absent on success. */
	reason?: string;
	/** The address it went to. Absent on failure. */
	to?: string;
}

/** Result of an on-demand scheduled-invoice run. */
export interface InvoiceRunResult {
	scanned: number;
	created: number;
	skipped: number;
	failed: number;
}

export interface CreateInvoicePayload {
	project_id: string;
	contract_id?: string;
	period_start?: string;
	period_end?: string;
	hours_detail_level?: HoursDetailLevel;
	recipient_user_id?: string | null;
	number?: string;
	currency?: string;
	issue_date?: string;
	due_date?: string;
	notes?: string;
	attach_hours?: boolean;
	hours_from?: string;
	hours_to?: string;
	hours_member_user_id?: string;
	line_items?: InvoiceLineItemInput[];
}

export interface UpdateInvoicePayload {
	hours_detail_level?: HoursDetailLevel;
	period_start?: string;
	period_end?: string;
	recipient_user_id?: string | null;
	number?: string;
	currency?: string;
	issue_date?: string;
	due_date?: string;
	notes?: string;
	attach_hours?: boolean;
	hours_from?: string;
	hours_to?: string;
	hours_member_user_id?: string;
	line_items?: InvoiceLineItemInput[];
}

function normalizeInvoice(invoice: Invoice): Invoice {
	return {
		...invoice,
		subtotal: Number(invoice.subtotal ?? 0),
		total: Number(invoice.total ?? 0),
		line_items: (invoice.line_items ?? []).map((line) => ({
			...line,
			quantity: Number(line.quantity ?? 0),
			unit_rate: Number(line.unit_rate ?? 0),
			amount: Number(line.amount ?? 0),
		})),
	};
}

export const invoiceService = {
	async listByProject(
		projectId: string,
		query?: {
			status?: InvoiceStatus;
			from?: string;
			to?: string;
			page?: number;
			limit?: number;
		},
	): Promise<InvoiceListResult> {
		try {
			const { data } = await apiClient.get<{ data: InvoiceListResult }>(
				`/api/invoices/project/${projectId}`,
				{ params: query },
			);
			return {
				total: data.data.total ?? 0,
				items: (data.data.items ?? []).map((invoice) =>
					normalizeInvoice(invoice),
				),
			};
		} catch (err) {
			throw new Error(
				extractApiErrorMessage(
					(err as { response?: { data?: unknown } }).response?.data,
					"Failed to load invoices",
				),
			);
		}
	},

	async create(payload: CreateInvoicePayload): Promise<Invoice> {
		try {
			const { data } = await apiClient.post<{ data: Invoice }>(
				"/api/invoices",
				payload,
			);
			return normalizeInvoice(data.data);
		} catch (err) {
			throw new Error(
				extractApiErrorMessage(
					(err as { response?: { data?: unknown } }).response?.data,
					"Failed to create invoice",
				),
			);
		}
	},

	async get(invoiceId: string): Promise<Invoice> {
		try {
			const { data } = await apiClient.get<{ data: Invoice }>(
				`/api/invoices/${invoiceId}`,
			);
			return normalizeInvoice(data.data);
		} catch (err) {
			throw new Error(
				extractApiErrorMessage(
					(err as { response?: { data?: unknown } }).response?.data,
					"Failed to load invoice",
				),
			);
		}
	},

	async update(
		invoiceId: string,
		payload: UpdateInvoicePayload,
	): Promise<Invoice> {
		try {
			const { data } = await apiClient.patch<{ data: Invoice }>(
				`/api/invoices/${invoiceId}`,
				payload,
			);
			return normalizeInvoice(data.data);
		} catch (err) {
			throw new Error(
				extractApiErrorMessage(
					(err as { response?: { data?: unknown } }).response?.data,
					"Failed to update invoice",
				),
			);
		}
	},

	/**
	 * Issue the invoice and email it to the client. The response carries the
	 * delivery outcome so the caller can report "issued, but not emailed".
	 */
	async issue(invoiceId: string): Promise<Invoice> {
		try {
			const { data } = await apiClient.post<{ data: Invoice }>(
				`/api/invoices/${invoiceId}/issue`,
			);
			return normalizeInvoice(data.data);
		} catch (err) {
			throw new Error(
				extractApiErrorMessage(
					(err as { response?: { data?: unknown } }).response?.data,
					"Failed to issue invoice",
				),
			);
		}
	},

	/** Re-send an already-issued invoice to the client. */
	async resend(invoiceId: string): Promise<InvoiceEmailDelivery> {
		try {
			const { data } = await apiClient.post<{ data: InvoiceEmailDelivery }>(
				`/api/invoices/${invoiceId}/resend`,
			);
			return data.data;
		} catch (err) {
			throw new Error(
				extractApiErrorMessage(
					(err as { response?: { data?: unknown } }).response?.data,
					"Failed to re-send the invoice",
				),
			);
		}
	},

	/** Delete a draft. Issued invoices must be voided, not erased. */
	async remove(invoiceId: string): Promise<void> {
		try {
			await apiClient.delete(`/api/invoices/${invoiceId}`);
		} catch (err) {
			throw new Error(
				extractApiErrorMessage(
					(err as { response?: { data?: unknown } }).response?.data,
					"Failed to delete the invoice",
				),
			);
		}
	},

	/**
	 * Draft every closed billing period the contract hasn't been billed for.
	 * Requires a signed/active contract; safe to run repeatedly.
	 */
	async generateScheduled(projectId: string): Promise<InvoiceRunResult> {
		try {
			const { data } = await apiClient.post<{ data: InvoiceRunResult }>(
				`/api/invoices/project/${projectId}/generate-scheduled`,
			);
			return data.data;
		} catch (err) {
			throw new Error(
				extractApiErrorMessage(
					(err as { response?: { data?: unknown } }).response?.data,
					"Failed to generate scheduled invoices",
				),
			);
		}
	},

	async generatePdf(invoiceId: string): Promise<{
		invoice_id: string;
		document_id: string;
		pdf_path: string;
		generated_at: string;
	}> {
		try {
			const { data } = await apiClient.post<{
				data: {
					invoice_id: string;
					document_id: string;
					pdf_path: string;
					generated_at: string;
				};
			}>(`/api/invoices/${invoiceId}/generate-pdf`);
			return data.data;
		} catch (err) {
			throw new Error(
				extractApiErrorMessage(
					(err as { response?: { data?: unknown } }).response?.data,
					"Failed to generate invoice PDF",
				),
			);
		}
	},

	/**
	 * Short-lived presigned URL for the stored PDF. Invoice documents live in
	 * the private R2 bucket, so there is no permanent public link — mirrors
	 * how payout proofs are read.
	 */
	async getPdfUrl(
		invoiceId: string,
	): Promise<{ url: string; expires_in: number }> {
		try {
			const { data } = await apiClient.get<{
				data: { url: string; expires_in: number };
			}>(`/api/invoices/${invoiceId}/pdf-url`);
			return data.data;
		} catch (err) {
			throw new Error(
				extractApiErrorMessage(
					(err as { response?: { data?: unknown } }).response?.data,
					"Failed to open the invoice PDF",
				),
			);
		}
	},
};
