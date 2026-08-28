/** Shared helpers for the marketplace wizards (talent go-live, consultant apply). */

/** Portfolio rows require a title; the hostname stands in for one the user never chose. */
export function safeHostname(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

/**
 * The eligibility-gated endpoints answer with a `missing` array of raw enum
 * values, which the old wizards pasted at the user verbatim. The review step's
 * checklist explains those properly, so point people at it instead.
 */
export function readError(cause: unknown): string {
	const response = (
		cause as {
			response?: {
				data?: { message?: string | string[]; missing?: string[] };
			};
		}
	)?.response?.data;

	if (response?.missing?.length) {
		return "Some things are still missing - see the checklist above.";
	}
	// Nest's ValidationPipe answers with an ARRAY of messages, one per failed
	// field. Returning it unread showed axios's generic "Request failed with
	// status code 400" and hid the one thing that says what was wrong.
	if (Array.isArray(response?.message)) {
		return response.message.slice(0, 3).join(". ");
	}
	if (response?.message) return response.message;
	if (cause instanceof Error) return cause.message;
	return "Something went wrong. Please try again.";
}
