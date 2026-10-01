import apiClient from "@/api/axios";
import { apiErrorFrom } from "@/lib/apiErrors";
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

/**
 * One of the team's projects whose finance the caller may read under the
 * project-scoped gate imports and the project invoice workspace enforce
 * (project `finance.view`, or a team-running role on the team book). Pickers and tabs are built from this list, never from the team's
 * plain attachment list (which also carries projects the caller is only an
 * editor on).
 */
export interface TeamFinanceProject {
	id: string;
	title: string | null;
	status: string | null;
	currency: string | null;
	/** Upload/record imports and issue invoices (`finance.manage_invoices`). */
	can_manage_invoices: boolean;
}

async function get<T>(path: string, params?: object): Promise<T> {
	try {
		const { data } = await apiClient.get<{ data: T }>(path, { params });
		return data.data;
	} catch (error) {
		throw apiErrorFrom(error, "Failed to load team finance data");
	}
}

export const teamFinanceService = {
	teams: () => get<AdministeredTeam[]>("/api/team-finance/teams"),
	financeProjects: (teamId: string) =>
		get<TeamFinanceProject[]>(
			`/api/team-finance/teams/${teamId}/finance-projects`,
		),
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
