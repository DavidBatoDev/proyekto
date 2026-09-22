import axios from "axios";
import { API_BASE_URL } from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

/**
 * The public contact form.
 *
 * A bare axios instance, deliberately NOT the shared `apiClient`: whoever fills
 * this in has no Proyekto account, so the auth interceptor has no token to
 * attach and its 401/403 handling would be wrong. Same approach as
 * `contract-signing.service.ts` and the roadmap public-share service.
 */
const publicClient = axios.create({
	baseURL: API_BASE_URL,
	headers: { "Content-Type": "application/json" },
});

export type ContactTopic = "sales" | "support" | "partnership" | "other";

export interface ContactMessage {
	name: string;
	email: string;
	topic: ContactTopic;
	message: string;
	company?: string;
}

/**
 * Posts the message. Resolves when the server accepted it.
 *
 * The server answers 200 even when the mail transport is down — losing the
 * message either way and telling the sender it failed helps nobody — so a
 * resolved promise means "accepted", not "delivered to an inbox".
 */
export async function sendContactMessage(input: ContactMessage): Promise<void> {
	try {
		await publicClient.post("/api/contact", input);
	} catch (error) {
		const body = axios.isAxiosError(error) ? error.response?.data : null;
		throw new Error(
			extractApiErrorMessage(
				body,
				"We couldn't send that just now. Try again in a moment.",
			),
		);
	}
}
