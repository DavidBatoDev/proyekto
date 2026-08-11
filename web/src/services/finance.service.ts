import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

export interface FinanceFilters {
	q?: string;
	project_id?: string;
	project_status?: string;
	currency?: string;
	from?: string;
	to?: string;
}

export interface FinanceProject {
	id: string;
	title: string;
	status: string;
	currency: string;
	owner_id: string | null;
	created_at: string;
	revenue: number;
	collected: number;
	outstanding: number;
	cost: number;
	margin: number;
	margin_percent: number | null;
	invoice_count: number;
	latest_contract: { id: string; status: string; version: number } | null;
}

export interface FinanceCurrencyTotals {
	currency: string;
	revenue: number;
	collected: number;
	outstanding: number;
	cost: number;
	margin: number;
	margin_percent: number | null;
	invoice_count: number;
	project_count: number;
}

export interface FinancePortfolio {
	projects: FinanceProject[];
	totals_by_currency: FinanceCurrencyTotals[];
}

export interface FinanceContractSummary {
	id: string;
	project_id: string;
	contract_number: string | null;
	status: string;
	version: number;
	currency: string;
	billing_mode: string;
	recurring_fee: number | null;
	client_name: string | null;
	service_start_date: string | null;
	service_end_date: string | null;
	updated_at: string;
	project: FinanceProject | null;
}

export interface FinanceInvoiceSummary {
	id: string;
	project_id: string;
	number: string;
	status: string;
	currency: string;
	total: number;
	origin: string;
	issue_date: string | null;
	due_date: string | null;
	updated_at: string;
	project: FinanceProject | null;
}

interface Page<T> {
	items: T[];
	total: number;
}

async function get<T>(path: string, params: object): Promise<T> {
	try {
		const { data } = await apiClient.get<{ data: T }>(path, { params });
		return data.data;
	} catch (error) {
		throw new Error(
			extractApiErrorMessage(
				(error as { response?: { data?: unknown } }).response?.data,
				"Failed to load finance data",
			),
		);
	}
}

export const financeService = {
	portfolio: (filters: FinanceFilters) =>
		get<FinancePortfolio>("/api/finance/portfolio", filters),
	contracts: (filters: FinanceFilters & { contract_status?: string }) =>
		get<Page<FinanceContractSummary>>("/api/finance/contracts", filters),
	invoices: (filters: FinanceFilters & { invoice_status?: string }) =>
		get<Page<FinanceInvoiceSummary>>("/api/finance/invoices", filters),
};
