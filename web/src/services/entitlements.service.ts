import apiClient from "@/api/axios";
import {
	normalizeWorkspaceUsage,
	type WorkspaceUsage,
} from "@/lib/entitlements";
import { toServiceError } from "@/lib/planLimitErrors";
import {
	isLimitKey,
	LIMIT_DEFINITIONS,
	type LimitKey,
	type LimitKind,
	limitDefinition,
	normalizePlanLimits,
	type PlanId,
	type PlanLimits,
} from "@/lib/planLimits";

export type {
	RoadmapNodeUsage,
	WorkspaceUsage,
	WorkspaceUsageFeature,
} from "@/lib/entitlements";

/** A key's metadata as `GET /api/plans` publishes it. */
export interface PublicLimitKeyMeta {
	key: LimitKey;
	kind: LimitKind;
	label: string;
	unit: string | null;
	group: string;
	sort_order: number;
	description: string | null;
}

export interface PublicPlanLimits {
	limits: Record<PlanId, PlanLimits>;
	keys: PublicLimitKeyMeta[];
	/** max(updated_at) of the matrix; null when the server sent none. */
	version: string | null;
}

/**
 * Readable by any member of the workspace, so a plain member loading a page
 * never trips a 403. Roadmap names in the payload are already filtered to the
 * ones the viewer can open.
 */
export async function getWorkspaceUsage(
	workspaceId: string,
): Promise<WorkspaceUsage> {
	try {
		const { data } = await apiClient.get<{ data: unknown }>(
			`/api/workspaces/${workspaceId}/usage`,
		);
		return normalizeWorkspaceUsage(data?.data, workspaceId);
	} catch (error) {
		throw toServiceError(error, "Failed to load workspace usage.");
	}
}

function normalizeKeys(raw: unknown): PublicLimitKeyMeta[] {
	const fromCatalogue = (): PublicLimitKeyMeta[] =>
		LIMIT_DEFINITIONS.map((definition, index) => ({
			key: definition.key,
			kind: definition.kind,
			label: definition.label,
			unit: definition.unit?.plural ?? null,
			group: definition.group,
			sort_order: index,
			description: null,
		}));
	if (!Array.isArray(raw)) return fromCatalogue();
	const keys: PublicLimitKeyMeta[] = [];
	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const row = item as Record<string, unknown>;
		// Keys the web does not know have no cells here; skip them rather than
		// render a row with nothing in it.
		if (!isLimitKey(row.key)) continue;
		const definition = limitDefinition(row.key);
		if (!definition) continue;
		keys.push({
			key: row.key,
			kind: definition.kind,
			label:
				typeof row.label === "string" && row.label
					? row.label
					: definition.label,
			unit: typeof row.unit === "string" ? row.unit : null,
			group:
				typeof row.group === "string" && row.group
					? row.group
					: definition.group,
			sort_order:
				typeof row.sort_order === "number" ? row.sort_order : keys.length,
			description: typeof row.description === "string" ? row.description : null,
		});
	}
	return keys.length > 0 ? keys : fromCatalogue();
}

/**
 * The public matrix behind /pricing. Every cell is validated and falls back to
 * the seed; a body with no `limits` object at all is an error, so the hook
 * keeps rendering the defaults instead of calling a guess "live".
 */
export async function getPublicPlanLimits(): Promise<PublicPlanLimits> {
	const { data } = await apiClient.get<{ data: unknown }>("/api/plans");
	const body = data?.data;
	if (
		typeof body !== "object" ||
		body === null ||
		typeof (body as { limits?: unknown }).limits !== "object" ||
		(body as { limits?: unknown }).limits === null
	) {
		throw new Error("Plan limits response was malformed.");
	}
	const payload = body as {
		limits: unknown;
		keys?: unknown;
		version?: unknown;
	};
	return {
		limits: normalizePlanLimits(payload.limits),
		keys: normalizeKeys(payload.keys),
		version:
			typeof payload.version === "string" && payload.version
				? payload.version
				: null,
	};
}
