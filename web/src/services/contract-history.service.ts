import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";
import type { Contract, ContractStatus } from "@/services/contract.service";

/**
 * Two-way contract authoring: send, withdraw, review, version history, the
 * deterministic comparison and the AI change summary.
 * (docs/13-proposals/two-way-contract-authoring.md)
 */

export type Seat = "hirer" | "provider" | "viewer";

export interface RevisionChange {
	field: string;
	label: string;
	before: unknown;
	after: unknown;
}

export interface ContractRevision {
	revision: number;
	author_user_id: string | null;
	author_name: string | null;
	author_position: "hirer" | "provider" | null;
	created_at: string;
	/** Changed by the other party since the viewer last reviewed. */
	unseen: boolean;
	changes: RevisionChange[];
}

export interface ContractRevisions {
	revision: number;
	last_viewed_revision: number | null;
	unseen_changes: boolean;
	revisions: ContractRevision[];
}

export interface ContractVersionEntry {
	id: string;
	version: number;
	revision: number;
	status: ContractStatus;
	document_title: string | null;
	effective_from: string | null;
	created_at: string;
	proposed_by: string | null;
	proposed_by_capacity: "client" | "consultant" | "talent" | null;
	proposed_by_name: string | null;
	signatures: Array<{
		position: "hirer" | "provider";
		capacity: string;
		name: string | null;
		signed_at: string | null;
	}>;
	snapshot: {
		sha256: string | null;
		taken_at: string | null;
		kind: "at_signing" | "backfill" | null;
	} | null;
	supersedes_contract_id: string | null;
}

export interface FieldDiffRow {
	id: string;
	kind: "field";
	field: string;
	label: string;
	before: unknown;
	after: unknown;
}

export interface ClauseDiffRow {
	id: string;
	kind: "clause";
	key: string;
	title: string;
	change: "added" | "removed" | "changed";
	before: string | null;
	after: string | null;
}

export interface ServiceDiffRow {
	id: string;
	kind: "service";
	service_id: string;
	name: string;
	change: "added" | "removed" | "changed";
	before: { name: string; unit_rate: number; unit?: string | null } | null;
	after: { name: string; unit_rate: number; unit?: string | null } | null;
}

export interface ContractComparison {
	from: {
		id: string;
		version: number;
		revision: number;
		status: ContractStatus;
	};
	to: { id: string; version: number; revision: number; status: ContractStatus };
	seat: Seat;
	diff: {
		fields: FieldDiffRow[];
		clauses: ClauseDiffRow[];
		services: ServiceDiffRow[];
	};
}

export interface ContractChangeSummary {
	headline: string;
	bullets: Array<{ text: string; row_ids: string[] }>;
	for_you: string | null;
	seat: Seat;
	model: string;
	cached: boolean;
	generated_at: string;
	disclaimer: string;
	rows: number;
}

function fail(err: unknown, fallback: string): never {
	throw new Error(
		extractApiErrorMessage(
			(err as { response?: { data?: unknown } }).response?.data,
			fallback,
		),
	);
}

export const contractHistoryService = {
	async send(contractId: string): Promise<Contract> {
		try {
			const { data } = await apiClient.post<{ data: Contract }>(
				`/api/contracts/${contractId}/send`,
			);
			return data.data;
		} catch (err) {
			fail(err, "Failed to send the contract");
		}
	},

	async withdraw(contractId: string): Promise<Contract> {
		try {
			const { data } = await apiClient.post<{ data: Contract }>(
				`/api/contracts/${contractId}/withdraw`,
			);
			return data.data;
		} catch (err) {
			fail(err, "Failed to withdraw the contract");
		}
	},

	async markViewed(contractId: string, revision: number): Promise<void> {
		try {
			await apiClient.post(`/api/contracts/${contractId}/viewed`, { revision });
		} catch (err) {
			fail(err, "Failed to record your review");
		}
	},

	async revisions(contractId: string): Promise<ContractRevisions> {
		try {
			const { data } = await apiClient.get<{ data: ContractRevisions }>(
				`/api/contracts/${contractId}/revisions`,
			);
			return data.data;
		} catch (err) {
			fail(err, "Failed to load the changes");
		}
	},

	async history(
		contractId: string,
	): Promise<{ family_id: string | null; versions: ContractVersionEntry[] }> {
		try {
			const { data } = await apiClient.get<{
				data: { family_id: string | null; versions: ContractVersionEntry[] };
			}>(`/api/contracts/${contractId}/history`);
			return data.data;
		} catch (err) {
			fail(err, "Failed to load the history");
		}
	},

	async compare(
		contractId: string,
		otherId: string,
	): Promise<ContractComparison> {
		try {
			const { data } = await apiClient.get<{ data: ContractComparison }>(
				`/api/contracts/${contractId}/compare/${otherId}`,
			);
			return data.data;
		} catch (err) {
			fail(err, "Failed to compare the versions");
		}
	},

	async summary(
		contractId: string,
		otherId: string,
	): Promise<ContractChangeSummary> {
		try {
			const { data } = await apiClient.post<{ data: ContractChangeSummary }>(
				`/api/contracts/${contractId}/compare/${otherId}/summary`,
			);
			return data.data;
		} catch (err) {
			fail(err, "The AI summary is not available right now");
		}
	},

	/** The frozen PDF of a signed version, as a blob URL plus its hash check. */
	async signedPdf(contractId: string): Promise<{
		url: string;
		sha256: string | null;
		verified: boolean;
		kind: string | null;
		takenAt: string | null;
	}> {
		try {
			const response = await apiClient.get<Blob>(
				`/api/contracts/${contractId}/signed-pdf`,
				{ responseType: "blob" },
			);
			const header = (name: string) =>
				(response.headers[name.toLowerCase()] as string | undefined) || null;
			return {
				url: URL.createObjectURL(response.data),
				sha256: header("X-Content-SHA256"),
				verified: header("X-Snapshot-Verified") === "true",
				kind: header("X-Snapshot-Kind"),
				takenAt: header("X-Snapshot-Taken-At"),
			};
		} catch (err) {
			fail(err, "Failed to open the signed agreement");
		}
	},
};

/** A diff value as a reader would say it. */
export function formatDiffValue(value: unknown): string {
	if (value === null || value === undefined || value === "") return "—";
	if (typeof value === "boolean") return value ? "Yes" : "No";
	if (Array.isArray(value))
		return `${value.length} item${value.length === 1 ? "" : "s"}`;
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}
