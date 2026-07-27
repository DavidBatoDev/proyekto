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

export interface ProjectFinancials {
	project_id: string;
	currency: string;
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
