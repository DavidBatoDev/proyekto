// Centralized handling for backend `MissingPermissionException` 403s.
//
// Backend shape (see backend/src/modules/projects/authorization/missing-permission.exception.ts):
//   {
//     "code": "missing_permission",
//     "message": "...",
//     "path": "roadmap.edit" | null,
//     "label": "edit the roadmap" | null,
//     "requiredRole": "admin" | null
//   }
//
// We map the path back to the friendlier label from the shared frontend
// catalogue when possible, then surface a readable message.

import { PERMISSION_SECTIONS } from "@/components/project/permissions/permissionCatalog";

export type MissingPermissionPayload = {
	code: "missing_permission";
	message?: string;
	path?: string | null;
	label?: string | null;
	requiredRole?: string | null;
};

export type ParsedPermissionError = {
	/** Path the action required ('roadmap.edit') or null when role-based. */
	path: string | null;
	/** Friendly label e.g. "Edit roadmap" or "edit the roadmap". */
	label: string | null;
	/** Minimum role when the gate was role-based ('admin') — else null. */
	requiredRole: string | null;
	/** Server-provided message; safe to show as-is. */
	message: string;
};

const PATH_LABEL_BY_ID = (() => {
	const map = new Map<string, string>();
	for (const section of PERMISSION_SECTIONS) {
		for (const perm of section.permissions) {
			map.set(perm.path, perm.label);
		}
	}
	return map;
})();

/**
 * Resolve a permission path → friendly catalogue label, e.g.
 * 'roadmap.edit' → 'Edit roadmap'. Returns null if unknown.
 */
export function getPermissionLabel(path: string | null | undefined): string | null {
	if (!path) return null;
	return PATH_LABEL_BY_ID.get(path) ?? null;
}

/**
 * Pull a structured `MissingPermissionPayload` out of an error of unknown
 * shape. Looks at common Axios/fetch error layouts and the response body
 * we control. Returns null when the error isn't a 403 / isn't structured.
 */
export function parseMissingPermissionError(
	err: unknown,
): ParsedPermissionError | null {
	if (!err) return null;

	// Best-effort: walk a few common shapes.
	type Maybe = {
		response?: { data?: unknown; status?: number };
		status?: number;
		data?: unknown;
		message?: unknown;
	};
	const e = err as Maybe;
	const status =
		(typeof e.status === "number" ? e.status : null) ??
		(typeof e.response?.status === "number" ? e.response.status : null);
	const body =
		(e.response?.data as unknown) ??
		(e.data as unknown) ??
		(typeof e.message === "string"
			? safeParseJson(e.message)
			: e.message);

	if (status !== null && status !== 403) return null;

	if (body && typeof body === "object") {
		const b = body as Record<string, unknown>;
		// NestJS HttpException body lives under `message` for HttpException
		// or directly on the body for ForbiddenException-with-object.
		const inner = (b.message && typeof b.message === "object"
			? (b.message as Record<string, unknown>)
			: b) as Record<string, unknown>;
		if (inner.code === "missing_permission") {
			return {
				path: typeof inner.path === "string" ? inner.path : null,
				label: typeof inner.label === "string" ? inner.label : null,
				requiredRole:
					typeof inner.requiredRole === "string" ? inner.requiredRole : null,
				message:
					typeof inner.message === "string"
						? inner.message
						: "You do not have permission to perform this action.",
			};
		}
	}

	return null;
}

/**
 * Compose a human-readable error message for a missing permission. Uses
 * the catalog's friendly label when available; falls back to the raw path
 * or the server-provided message.
 *
 * Example output:
 *   "You don't have permission to Edit roadmap (roadmap.edit)."
 *   "Insufficient role on this project — need admin or stronger."
 */
export function formatMissingPermission(parsed: ParsedPermissionError): string {
	const catalogLabel = getPermissionLabel(parsed.path);
	if (catalogLabel) {
		return parsed.path
			? `You don't have permission to ${catalogLabel} (${parsed.path}).`
			: `You don't have permission to ${catalogLabel}.`;
	}
	if (parsed.label && parsed.path) {
		return `You don't have permission to ${parsed.label} (${parsed.path}).`;
	}
	if (parsed.label) {
		return `You don't have permission to ${parsed.label}.`;
	}
	return parsed.message;
}

function safeParseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

/**
 * Pull a usable error message out of a NestJS-style response body.
 *
 * NestJS `HttpException`s with an object payload land under `body.message`
 * as the OBJECT (not a string), so the common
 * `body.message || body.error?.message || fallback` chain falls through
 * to the fallback even when the server returned a perfectly readable
 * `message` field inside the structured payload. This walks the layered
 * shape and returns the most specific human-readable string available.
 *
 * Resolution order:
 *   1. structured `missing_permission` → `formatMissingPermission`
 *   2. body.message.message (object payload + inner message)
 *   3. body.message (string)
 *   4. body.error.message
 *   5. fallback
 */
export function extractApiErrorMessage(
	body: unknown,
	fallback: string,
): string {
	const parsed = parseMissingPermissionError({ data: body, status: 403 });
	if (parsed) return formatMissingPermission(parsed);

	if (body && typeof body === "object") {
		const b = body as Record<string, unknown>;
		// NestJS HttpException with object payload: { statusCode, message: {...}, error }
		if (b.message && typeof b.message === "object") {
			const inner = b.message as Record<string, unknown>;
			if (typeof inner.message === "string" && inner.message) {
				return inner.message;
			}
		}
		if (typeof b.message === "string" && b.message) return b.message;
		if (b.error && typeof b.error === "object") {
			const err = b.error as Record<string, unknown>;
			if (typeof err.message === "string" && err.message) return err.message;
		}
	}

	return fallback;
}
