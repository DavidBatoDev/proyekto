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
	source_type: "manual" | "time_log";
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

export interface Invoice {
	id: string;
	project_id: string;
	issuer_user_id: string;
	recipient_user_id: string | null;
	number: string;
	status: InvoiceStatus;
	currency: string;
	issue_date: string | null;
	due_date: string | null;
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
}

export interface InvoiceListResult {
	items: Invoice[];
	total: number;
}

export interface CreateInvoicePayload {
	project_id: string;
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

	async update(invoiceId: string, payload: UpdateInvoicePayload): Promise<Invoice> {
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

	async generatePdf(
		invoiceId: string,
	): Promise<{
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
};
