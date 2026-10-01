import { extractApiErrorMessage } from "@/lib/permissionErrors";

/**
 * An API failure that keeps its HTTP status.
 *
 * Services used to rethrow `new Error(message)`, which dropped the status: a
 * 403 from a permission gate and a dropped connection looked the same to the
 * caller, so React Query retried the refusal and pages could not tell "you may
 * not see this" from "this failed".
 */
export class ApiError extends Error {
	readonly status: number | null;

	constructor(message: string, status: number | null, cause?: unknown) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		if (cause !== undefined) {
			(this as { cause?: unknown }).cause = cause;
		}
	}
}

/** The HTTP status of an axios error, an ApiError, or a status-stamped Error. */
export function httpStatusOf(error: unknown): number | null {
	if (!error || typeof error !== "object") return null;
	const candidate = error as {
		status?: unknown;
		response?: { status?: unknown };
	};
	if (typeof candidate.status === "number") return candidate.status;
	if (typeof candidate.response?.status === "number") {
		return candidate.response.status;
	}
	return null;
}

/** Wrap an axios failure with a readable message, keeping its status. */
export function apiErrorFrom(error: unknown, fallback: string): ApiError {
	const response = (error as { response?: { data?: unknown } } | null)
		?.response;
	return new ApiError(
		extractApiErrorMessage(response?.data, fallback),
		httpStatusOf(error),
		error,
	);
}

/**
 * A refusal rather than a failure: unauthenticated, forbidden, or not found.
 * The finance gates answer "not yours" with 403 (project capability) or 404
 * (team/book membership, so a miss does not confirm the record exists).
 */
export function isAccessDeniedError(error: unknown): boolean {
	const status = httpStatusOf(error);
	return status === 401 || status === 403 || status === 404;
}

/**
 * React Query `retry` policy: never retry a refusal (asking again cannot turn
 * a 403 into a 200, and the retries were what kept a spinner up for seconds
 * before the page fell through to an empty state); retry anything else at
 * most `maxRetries` times.
 */
export function retryUnlessAccessDenied(maxRetries = 2) {
	return (failureCount: number, error: unknown): boolean =>
		!isAccessDeniedError(error) && failureCount < maxRetries;
}
