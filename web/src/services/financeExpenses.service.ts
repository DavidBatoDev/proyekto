import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

/**
 * Team expenses — money out that is not a payout: contractors, software and
 * subscriptions, overhead, taxes and fees, and salaries paid outside
 * Proyekto. Recorded by the team owner, a manager, or an accountant; recorded
 * payouts are counted as salary automatically and never re-entered here.
 */
export type ExpenseCategory =
	| "salary"
	| "contractor"
	| "software_subscription"
	| "overhead"
	| "tax_fees"
	| "other";

export type ExpenseRecurrence = "none" | "monthly" | "yearly";

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
	salary: "Salary",
	contractor: "Contractor",
	software_subscription: "Software & subscriptions",
	overhead: "Overhead",
	tax_fees: "Taxes & fees",
	other: "Other",
};

export interface FinanceExpense {
	id: string;
	team_id: string;
	book_id: string | null;
	project_id: string | null;
	category: ExpenseCategory;
	description: string;
	vendor: string | null;
	amount: number;
	currency: string;
	incurred_on: string;
	recurrence: ExpenseRecurrence;
	recurrence_ends_on: string | null;
	document_id: string | null;
	created_by: string;
	created_at: string;
	updated_at: string;
	voided_at: string | null;
	voided_by: string | null;
}

export interface ExpenseSummary {
	currency: string;
	expenses_total: number;
	payouts_total: number;
	total: number;
	by_category: Partial<Record<ExpenseCategory, number>>;
}

export interface TeamExpensesResponse {
	expenses: FinanceExpense[];
	can_manage: boolean;
	summary: ExpenseSummary[];
}

export interface ExpenseInput {
	category: ExpenseCategory;
	description: string;
	vendor?: string | null;
	amount: number;
	currency: string;
	incurred_on: string;
	recurrence?: ExpenseRecurrence;
	recurrence_ends_on?: string | null;
	project_id?: string | null;
	document_id?: string | null;
}

async function request<T>(
	method: "get" | "post" | "patch",
	path: string,
	body?: object,
): Promise<T> {
	try {
		const { data } =
			method === "get"
				? await apiClient.get<{ data: T }>(path)
				: method === "patch"
					? await apiClient.patch<{ data: T }>(path, body)
					: await apiClient.post<{ data: T }>(path, body);
		return data.data;
	} catch (error) {
		throw new Error(
			extractApiErrorMessage(
				(error as { response?: { data?: unknown } }).response?.data,
				"Failed to load expenses",
			),
		);
	}
}

export const financeExpensesService = {
	list: (
		teamId: string,
		filters: { from?: string; to?: string; project_id?: string } = {},
	) => {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(filters)) {
			if (value) params.set(key, value);
		}
		const query = params.toString();
		return request<TeamExpensesResponse>(
			"get",
			`/api/finance-expenses/teams/${teamId}${query ? `?${query}` : ""}`,
		);
	},
	create: (teamId: string, input: ExpenseInput) =>
		request<FinanceExpense>(
			"post",
			`/api/finance-expenses/teams/${teamId}`,
			input,
		),
	update: (expenseId: string, input: Partial<ExpenseInput>) =>
		request<FinanceExpense>(
			"patch",
			`/api/finance-expenses/${expenseId}`,
			input,
		),
	void: (expenseId: string) =>
		request<FinanceExpense>("post", `/api/finance-expenses/${expenseId}/void`),
};
