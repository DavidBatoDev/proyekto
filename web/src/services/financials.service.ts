import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

export interface CurrencyTotals {
	currency: string;
	revenue: number;
	cost: number;
	margin: number;
	margin_percent: number | null;
}

export interface MonthPoint {
	month: string;
	revenue: number;
	cost: number;
	margin: number;
	margin_percent: number | null;
}

/** Unpaid balance split by how far past due it is. */
export interface FinanceAgingBands {
	current: number;
	d1_30: number;
	d31_60: number;
	d61_plus: number;
}

/** What is billed, what came back, and how late the rest is. */
export interface ProjectReceivables {
	billed: number;
	collected: number;
	outstanding: number;
	overdue_amount: number;
	overdue_count: number;
	invoice_count: number;
	aging: FinanceAgingBands;
	as_of: string;
}

export interface ProjectFinancials {
	project_id: string;
	currency: string;
	receivables: ProjectReceivables;
	totals: CurrencyTotals & {
		company_share: number;
		team_pool: number;
		team_burn: number;
		pool_remaining: number;
	};
	by_currency: CurrencyTotals[];
	months: MonthPoint[];
	economics: { company_percent: number; team_percent: number };
}

export const financialsService = {
	async getProjectFinancials(
		projectId: string,
		range?: { from?: string; to?: string },
	): Promise<ProjectFinancials> {
		try {
			const { data } = await apiClient.get<{ data: ProjectFinancials }>(
				`/api/projects/${projectId}/financials`,
				{ params: range },
			);
			return data.data;
		} catch (err) {
			throw new Error(
				extractApiErrorMessage(
					(err as { response?: { data?: unknown } }).response?.data,
					"Failed to load financials",
				),
			);
		}
	},
};
