import { getPendingProjectFromRoadmap } from "@/lib/guestRoadmapConversion";

export const AUTH_CONTINUATION_KEY = "proyekto_auth_continuation";

const AUTH_CONTINUATION_TTL_MS = 30 * 60 * 1000;

export type AuthContinuationSource = "login" | "signup";
export type AuthContinuationMethod = "password" | "google";
export type AuthContinuationLane = "client_freelancer" | "consultant";
export type AuthContinuationIntent = "client" | "freelancer";

export interface AuthContinuation {
	redirectTo?: string;
	source: AuthContinuationSource;
	authMethod: AuthContinuationMethod;
	lane?: AuthContinuationLane;
	intent?: AuthContinuationIntent;
	createdAt: string;
}

interface ResolvePostAuthDestinationOptions {
	explicitRedirect?: string | null;
	hasCompletedOnboarding?: boolean | null;
	nowMs?: number;
}

function getStorage(): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

function normalizeRedirectPath(value?: string | null): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return undefined;
	return trimmed;
}

function isAuthContinuation(value: unknown): value is AuthContinuation {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<AuthContinuation>;
	if (candidate.source !== "login" && candidate.source !== "signup") {
		return false;
	}
	if (
		candidate.authMethod !== "password" &&
		candidate.authMethod !== "google"
	) {
		return false;
	}
	return typeof candidate.createdAt === "string";
}

export function createRoadmapConversionPath(roadmapId: string): string {
	return `/project/roadmap/convert/${encodeURIComponent(roadmapId)}`;
}

export function rememberAuthContinuation({
	redirectTo,
	source,
	authMethod,
	lane,
	intent,
}: {
	redirectTo?: string | null;
	source: AuthContinuationSource;
	authMethod: AuthContinuationMethod;
	lane?: AuthContinuationLane;
	intent?: AuthContinuationIntent;
}): AuthContinuation | null {
	const storage = getStorage();
	if (!storage) return null;
	const safeRedirect = normalizeRedirectPath(redirectTo);

	const continuation: AuthContinuation = {
		source,
		authMethod,
		createdAt: new Date().toISOString(),
		...(safeRedirect ? { redirectTo: safeRedirect } : {}),
		...(lane ? { lane } : {}),
		...(intent ? { intent } : {}),
	};

	storage.setItem(AUTH_CONTINUATION_KEY, JSON.stringify(continuation));
	return continuation;
}

export function getAuthContinuation(
	nowMs = Date.now(),
): AuthContinuation | null {
	const storage = getStorage();
	if (!storage) return null;

	try {
		const raw = storage.getItem(AUTH_CONTINUATION_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!isAuthContinuation(parsed)) {
			storage.removeItem(AUTH_CONTINUATION_KEY);
			return null;
		}

		const createdMs = Date.parse(parsed.createdAt);
		if (
			!Number.isFinite(createdMs) ||
			nowMs - createdMs > AUTH_CONTINUATION_TTL_MS
		) {
			storage.removeItem(AUTH_CONTINUATION_KEY);
			return null;
		}

		return {
			...parsed,
			...(normalizeRedirectPath(parsed.redirectTo)
				? { redirectTo: normalizeRedirectPath(parsed.redirectTo) }
				: { redirectTo: undefined }),
		};
	} catch {
		storage.removeItem(AUTH_CONTINUATION_KEY);
		return null;
	}
}

export function clearAuthContinuation(): void {
	const storage = getStorage();
	storage?.removeItem(AUTH_CONTINUATION_KEY);
}

export function resolvePostAuthDestination({
	explicitRedirect,
	hasCompletedOnboarding,
	nowMs,
}: ResolvePostAuthDestinationOptions = {}): string {
	const pending = getPendingProjectFromRoadmap();
	if (pending?.roadmapId) {
		return hasCompletedOnboarding === false
			? "/welcome"
			: createRoadmapConversionPath(pending.roadmapId);
	}

	const continuation = getAuthContinuation(nowMs);
	const redirectTo =
		normalizeRedirectPath(explicitRedirect) ?? continuation?.redirectTo;
	if (redirectTo) {
		return hasCompletedOnboarding === false ? "/welcome" : redirectTo;
	}

	return hasCompletedOnboarding === false ? "/welcome" : "/dashboard";
}
