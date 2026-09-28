import axios, {
	type AxiosInstance,
	type InternalAxiosRequestConfig,
} from "axios";
import {
	formatMissingPermission,
	parseMissingPermissionError,
} from "../lib/permissionErrors";
import { notifyPlanLimit, parsePlanLimitError } from "../lib/planLimitErrors";
import { recordServerDate } from "../lib/serverClock";
import { getAccessToken } from "../lib/supabase";

// When each request left, so a response's `Date` header can be placed at the
// request's midpoint. See lib/serverClock.ts.
const requestSentAt = new WeakMap<InternalAxiosRequestConfig, number>();

function sampleServerClock(
	config: InternalAxiosRequestConfig | undefined,
	headers: unknown,
): void {
	const sentAt = config ? requestSentAt.get(config) : undefined;
	if (sentAt === undefined || !headers || typeof headers !== "object") return;
	recordServerDate(
		(headers as Record<string, unknown>).date,
		sentAt,
		Date.now(),
	);
}

// Module-level toast handler. The ToastProvider wires this on mount so the
// axios interceptor — which doesn't live inside React — can fire toasts on
// 403 `missing_permission` responses without each call site catching them
// individually. See web/src/contexts/ToastContext.tsx.
type ToastError = (message: string, durationMs?: number) => void;
let permissionToastHandler: ToastError | null = null;

export function setPermissionToastHandler(handler: ToastError | null): void {
	permissionToastHandler = handler;
}

// Get API base URL from environment variable
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Create axios instance with default configuration
const apiClient: AxiosInstance = axios.create({
	baseURL: API_BASE_URL,
	timeout: 30000, // 30 seconds
	headers: {
		"Content-Type": "application/json",
	},
});

// Request interceptor - Add auth token or guest user ID to requests
apiClient.interceptors.request.use(
	async (config: InternalAxiosRequestConfig) => {
		try {
			// Get access token from Supabase session
			const token = await getAccessToken();

			if (token && config.headers) {
				config.headers.Authorization = `Bearer ${token}`;
			} else {
				// No auth session — authenticate as a guest. The backend guard
				// (SupabaseAuthGuard) matches this header against
				// profiles.guest_session_id (a bearer-style secret), so we must send
				// the guest SESSION id, not the profile id.
				const guestSessionId =
					localStorage.getItem("proyekto_guest_session_id") ??
					localStorage.getItem("prdigy_guest_session_id");
				if (guestSessionId && config.headers) {
					config.headers["X-Guest-User-Id"] = guestSessionId;
				}
			}
		} catch (error) {
			console.error("Error adding auth headers:", error);
		}

		// Stamped after the async token lookup so the clock sample measures the
		// network round trip, not the session refresh.
		requestSentAt.set(config, Date.now());
		return config;
	},
	(error) => {
		return Promise.reject(error);
	},
);

// Response interceptor - Handle common errors
apiClient.interceptors.response.use(
	(response) => {
		sampleServerClock(response.config, response.headers);
		return response;
	},
	(error) => {
		// Handle common error scenarios
		if (error.response) {
			sampleServerClock(error.config, error.response.headers);
			// Server responded with error status
			const status = error.response.status;

			switch (status) {
				case 401:
					console.error("Unauthorized - Please log in");
					// Could trigger logout/redirect here
					break;
				case 403:
					{
						// A plan limit is not a permission problem: raise the upgrade
						// prompt (PlanLimitBridge shows it) and let the error propagate
						// unchanged so the caller can still render its own notice.
						const planLimit = parsePlanLimitError(error);
						if (planLimit) {
							notifyPlanLimit(planLimit);
							break;
						}

						const url = String(error.config?.url ?? "");
						const isExpectedTeamTimeForbidden =
							url.includes("/api/team-time/teams/") &&
							(url.includes("/my-rate") ||
								url.includes("/my?") ||
								url.endsWith("/my") ||
								url.includes("/tasks"));
						if (isExpectedTeamTimeForbidden) {
							break;
						}

						// Surface structured `missing_permission` errors as a toast so
						// per-call sites don't have to wire it themselves. The error
						// still propagates so callers can also render an inline
						// <PermissionDeniedBanner /> if they want a per-page treatment.
						const parsed = parseMissingPermissionError(error);
						if (parsed && permissionToastHandler) {
							permissionToastHandler(formatMissingPermission(parsed), 6000);
						}
					}
					console.error("Forbidden - Insufficient permissions");
					break;
				case 404:
					// Expected when a project has no roadmap yet; callers handle this as null.
					if (
						String(error.config?.url ?? "").includes("/api/roadmaps/project/")
					) {
						break;
					}
					console.error("Resource not found");
					break;
				case 429:
					console.error("Too many requests - Please try again later");
					break;
				case 500:
					console.error("Server error - Please try again later");
					break;
				default:
					console.error(`API Error (${status}):`, error.response.data);
			}
		} else if (error.request) {
			// Request made but no response received
			console.error("No response from server - Check your connection");
		} else {
			// Other errors
			console.error("Request error:", error.message);
		}

		return Promise.reject(error);
	},
);

// Export the configured axios instance
export default apiClient;

// Also export the base URL for cases where it's needed
export { API_BASE_URL };
