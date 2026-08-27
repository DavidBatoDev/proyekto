import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

/**
 * Finance books — the created, book-based finance surface (F1 personal,
 * F2 team, F3 project). No consultant gate: authorization is per-book
 * membership resolved server-side.
 */
export type FinanceBookKind = "personal" | "team" | "project";
export type FinanceBookRole =
	| "owner"
	| "manager"
	| "accountant"
	| "viewer_client"
	| "viewer";

export interface FinanceBook {
	id: string;
	kind: FinanceBookKind;
	owner_kind: "user" | "team";
	owner_user_id: string | null;
	owner_team_id: string | null;
	parent_book_id: string | null;
	project_id: string | null;
	currency: string;
	status: "active" | "archived";
	created_at: string;
	updated_at: string;
}

export interface MyFinanceBook extends FinanceBook {
	access_role: string;
	inherited: boolean;
}

export interface EngagedProject {
	project_id: string;
	project_title: string;
	contract_id: string;
	contract_status: string;
	relationship_kind: string;
	currency: string;
}

export interface PersonalDashboard {
	book: FinanceBook;
	engaged_projects: EngagedProject[];
	hours: {
		total_seconds: number;
		month_seconds: number;
		pending_seconds: number;
	};
	payouts_in: Array<{ currency: string; total: number; count: number }>;
}

export interface FinanceBookMember {
	id: string | null;
	book_id: string;
	user_id: string | null;
	invited_email: string | null;
	finance_role: FinanceBookRole;
	capabilities: Record<string, unknown> | null;
	inherited: boolean;
	source: "direct" | "parent" | "team_owner";
	granted_by: string | null;
	created_at: string | null;
	user: {
		id: string;
		display_name: string | null;
		avatar_url: string | null;
		email: string | null;
	} | null;
}

export type GrantableFinanceRole =
	| "manager"
	| "accountant"
	| "viewer_client"
	| "viewer";

export interface FinanceInvite {
	id: string;
	book_id: string;
	email: string;
	finance_role: FinanceBookRole;
	status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
	invited_by: string | null;
	expires_at: string;
	created_at: string;
}

export interface FinanceInvitePreview {
	invite: {
		id: string;
		email: string;
		finance_role: FinanceBookRole;
		status: FinanceInvite["status"];
		expires_at: string;
		created_at: string;
	};
	book: {
		id: string;
		kind: FinanceBookKind;
		currency: string;
		status: "active" | "archived";
		team: { id: string; name: string; avatar_url: string | null } | null;
	};
	invited_by: { id: string; display_name: string | null } | null;
}

async function request<T>(
	method: "get" | "post" | "patch" | "delete",
	path: string,
	body?: object,
): Promise<T> {
	try {
		const { data } =
			method === "get"
				? await apiClient.get<{ data: T }>(path)
				: method === "delete"
					? await apiClient.delete<{ data: T }>(path)
					: method === "patch"
						? await apiClient.patch<{ data: T }>(path, body)
						: await apiClient.post<{ data: T }>(path, body);
		return data.data;
	} catch (error) {
		throw new Error(
			extractApiErrorMessage(
				(error as { response?: { data?: unknown } }).response?.data,
				"Failed to load finance books",
			),
		);
	}
}

export type FinanceExportKind = "time_logs" | "payouts";
export type FinanceExportFormat = "csv" | "xlsx" | "pdf";

/**
 * Downloads a finance-book export through the authenticated axios client
 * (a bare anchor href would miss the Authorization header) and saves it via
 * a programmatic anchor, honoring the server's Content-Disposition filename.
 */
async function downloadExport(
	bookId: string,
	kind: FinanceExportKind,
	format: FinanceExportFormat,
	from?: string,
	to?: string,
): Promise<void> {
	try {
		const response = await apiClient.get<Blob>(
			`/api/finance-books/${bookId}/export`,
			{
				params: { kind, format, from, to },
				responseType: "blob",
			},
		);
		const disposition = String(
			response.headers["content-disposition"] ?? "",
		).match(/filename="([^"]+)"/);
		const filename =
			disposition?.[1] ?? `proyekto-${kind.replace("_", "-")}.${format}`;
		const url = URL.createObjectURL(response.data);
		const link = document.createElement("a");
		link.href = url;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	} catch (error) {
		// Blob error responses need decoding before the message is readable.
		const data = (error as { response?: { data?: unknown } }).response?.data;
		let decoded: unknown = data;
		if (data instanceof Blob) {
			try {
				decoded = JSON.parse(await data.text());
			} catch {
				decoded = undefined;
			}
		}
		throw new Error(
			extractApiErrorMessage(decoded, "Failed to export finance data"),
		);
	}
}

export const financeBooksService = {
	downloadExport,
	listMine: () => request<MyFinanceBook[]>("get", "/api/finance-books"),
	engagedProjects: () =>
		request<EngagedProject[]>("get", "/api/finance-books/engaged-projects"),
	personalDashboard: () =>
		request<PersonalDashboard>("get", "/api/finance-books/personal/dashboard"),
	createPersonal: (currency?: string) =>
		request<FinanceBook>("post", "/api/finance-books/personal", { currency }),
	createTeam: (input: {
		team_id: string;
		project_ids?: string[];
		currency?: string;
	}) =>
		request<{ book: FinanceBook; project_books: FinanceBook[] }>(
			"post",
			"/api/finance-books/team",
			input,
		),
	addProject: (bookId: string, projectId: string) =>
		request<FinanceBook>("post", `/api/finance-books/${bookId}/projects`, {
			project_id: projectId,
		}),
	get: (bookId: string) =>
		request<{
			book: FinanceBook;
			role: FinanceBookRole;
			permissions: Record<string, boolean>;
			inherited: boolean;
		}>("get", `/api/finance-books/${bookId}`),
	listMembers: (bookId: string) =>
		request<FinanceBookMember[]>("get", `/api/finance-books/${bookId}/members`),
	addMember: (
		bookId: string,
		input: {
			user_id: string;
			finance_role: GrantableFinanceRole;
			capabilities?: Record<string, unknown>;
		},
	) =>
		request<FinanceBookMember>(
			"post",
			`/api/finance-books/${bookId}/members`,
			input,
		),
	updateMember: (
		bookId: string,
		memberId: string,
		input: {
			finance_role?: GrantableFinanceRole;
			capabilities?: Record<string, unknown>;
		},
	) =>
		request<FinanceBookMember>(
			"patch",
			`/api/finance-books/${bookId}/members/${memberId}`,
			input,
		),
	removeMember: (bookId: string, memberId: string) =>
		request<{ removed: true }>(
			"delete",
			`/api/finance-books/${bookId}/members/${memberId}`,
		),
	listInvites: (bookId: string) =>
		request<FinanceInvite[]>("get", `/api/finance-books/${bookId}/invites`),
	createInvite: (
		bookId: string,
		input: {
			email: string;
			finance_role: GrantableFinanceRole;
			capabilities?: Record<string, unknown>;
		},
	) =>
		request<
			FinanceInvite & {
				accept_url: string;
				email_delivery: { sent: boolean; reason?: string };
			}
		>("post", `/api/finance-books/${bookId}/invites`, input),
	cancelInvite: (bookId: string, inviteId: string) =>
		request<FinanceInvite>(
			"delete",
			`/api/finance-books/${bookId}/invites/${inviteId}`,
		),
	getInvite: (token: string) =>
		request<FinanceInvitePreview>("get", `/api/finance-invites/${token}`),
	acceptInvite: (token: string) =>
		request<{ book_id: string; finance_role: FinanceBookRole }>(
			"post",
			`/api/finance-invites/${token}/accept`,
			{},
		),
	declineInvite: (token: string) =>
		request<{ declined: true }>(
			"post",
			`/api/finance-invites/${token}/decline`,
			{},
		),
};
