import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";
import type {
	FinanceContractSummary,
	FinanceFilters,
	FinanceInvoiceSummary,
	FinancePageQuery,
	FinancePortfolio,
	Page,
} from "@/services/finance.service";

/**
 * Team finance — the team administrator's ("HR") view.
 *
 * Same payload shapes as `financeService`, scoped to one team's attached
 * projects, with one deliberate difference: `cost`, `margin`, and
 * `margin_percent` come back null. They are the owner's economics, and the
 * backend never computes them for this surface. Unlike `/api/finance/*`,
 * these endpoints carry no consultant gate — authorization is team role plus
 * the per-project `finance.*` capability.
 */
export interface AdministeredTeam {
	id: string;
	name: string;
	owner_id: string;
	/** Attached projects the caller can see finance for. */
	project_count: number;
}

async function get<T>(path: string, params?: object): Promise<T> {
	try {
		const { data } = await apiClient.get<{ data: T }>(path, { params });
		return data.data;
	} catch (error) {
		throw new Error(
			extractApiErrorMessage(
				(error as { response?: { data?: unknown } }).response?.data,
				"Failed to load team finance data",
			),
		);
	}
}

export const teamFinanceService = {
	teams: () => get<AdministeredTeam[]>("/api/team-finance/teams"),
	portfolio: (teamId: string, filters: FinanceFilters) =>
		get<FinancePortfolio>(
			`/api/team-finance/teams/${teamId}/portfolio`,
			filters,
		),
	contracts: (
		teamId: string,
		filters: FinanceFilters & FinancePageQuery & { contract_status?: string },
	) =>
		get<Page<FinanceContractSummary>>(
			`/api/team-finance/teams/${teamId}/contracts`,
			filters,
		),
	invoices: (
		teamId: string,
		filters: FinanceFilters & FinancePageQuery & { invoice_status?: string },
	) =>
		get<Page<FinanceInvoiceSummary>>(
			`/api/team-finance/teams/${teamId}/invoices`,
			filters,
		),
};
