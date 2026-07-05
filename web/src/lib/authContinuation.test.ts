import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AUTH_CONTINUATION_KEY,
	clearAuthContinuation,
	getAuthContinuation,
	rememberAuthContinuation,
	resolvePostAuthDestination,
} from "./authContinuation";
import { PENDING_PROJECT_FROM_ROADMAP_KEY } from "./guestRoadmapConversion";

class MemoryStorage implements Storage {
	private readonly values = new Map<string, string>();

	get length() {
		return this.values.size;
	}

	clear() {
		this.values.clear();
	}

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	key(index: number) {
		return Array.from(this.values.keys())[index] ?? null;
	}

	removeItem(key: string) {
		this.values.delete(key);
	}

	setItem(key: string, value: string) {
		this.values.set(key, String(value));
	}
}

let sessionStore: MemoryStorage;
let localStore: MemoryStorage;

beforeEach(() => {
	sessionStore = new MemoryStorage();
	localStore = new MemoryStorage();
	vi.stubGlobal("sessionStorage", sessionStore);
	vi.stubGlobal("localStorage", localStore);
	vi.stubGlobal("window", {
		sessionStorage: sessionStore,
		localStorage: localStore,
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function rememberPendingRoadmap(roadmapId = "roadmap-1") {
	localStore.setItem(
		PENDING_PROJECT_FROM_ROADMAP_KEY,
		JSON.stringify({
			roadmapId,
			title: "Guest roadmap",
			createdAt: "2026-07-05T00:00:00.000Z",
			source: "roadmap_cta",
		}),
	);
}

describe("auth continuation storage", () => {
	it("stores a safe transient auth continuation", () => {
		const continuation = rememberAuthContinuation({
			redirectTo: "/project/roadmap/convert/roadmap-1",
			source: "login",
			authMethod: "google",
		});

		expect(continuation?.redirectTo).toBe("/project/roadmap/convert/roadmap-1");
		expect(getAuthContinuation()).toMatchObject({
			redirectTo: "/project/roadmap/convert/roadmap-1",
			source: "login",
			authMethod: "google",
			postSignupWelcomeRequired: false,
		});
	});

	it("marks signup continuations as welcome-required", () => {
		const continuation = rememberAuthContinuation({
			redirectTo: "/project/roadmap/convert/roadmap-1",
			source: "signup",
			authMethod: "google",
		});

		expect(continuation).toMatchObject({
			source: "signup",
			authMethod: "google",
			postSignupWelcomeRequired: true,
		});
		expect(getAuthContinuation()?.postSignupWelcomeRequired).toBe(true);
	});

	it("drops stale continuation state", () => {
		const nowMs = Date.parse("2026-07-05T12:00:00.000Z");
		sessionStore.setItem(
			AUTH_CONTINUATION_KEY,
			JSON.stringify({
				redirectTo: "/dashboard",
				source: "login",
				authMethod: "google",
				createdAt: "2026-07-05T11:20:00.000Z",
			}),
		);

		expect(getAuthContinuation(nowMs)).toBeNull();
		expect(sessionStore.getItem(AUTH_CONTINUATION_KEY)).toBeNull();
	});

	it("ignores unsafe redirect targets", () => {
		rememberAuthContinuation({
			redirectTo: "https://evil.example/path",
			source: "login",
			authMethod: "google",
		});

		expect(getAuthContinuation()?.redirectTo).toBeUndefined();
	});

	it("clears continuation state", () => {
		rememberAuthContinuation({
			redirectTo: "/dashboard",
			source: "login",
			authMethod: "password",
		});

		clearAuthContinuation();

		expect(getAuthContinuation()).toBeNull();
	});
});

describe("resolvePostAuthDestination", () => {
	it("sends Google signup continuations through welcome even after provisioning", () => {
		rememberAuthContinuation({
			redirectTo: "/project/roadmap/convert/roadmap-1",
			source: "signup",
			authMethod: "google",
		});

		expect(
			resolvePostAuthDestination({
				hasCompletedOnboarding: true,
			}),
		).toBe("/welcome");
	});

	it("sends password signup continuations through welcome", () => {
		rememberAuthContinuation({
			source: "signup",
			authMethod: "password",
		});

		expect(
			resolvePostAuthDestination({
				hasCompletedOnboarding: true,
			}),
		).toBe("/welcome");
	});

	it("sends completed users with a pending roadmap to conversion", () => {
		rememberPendingRoadmap("roadmap-abc");

		expect(
			resolvePostAuthDestination({
				explicitRedirect: "/dashboard",
				hasCompletedOnboarding: true,
			}),
		).toBe("/project/roadmap/convert/roadmap-abc");
	});

	it("sends Google login continuations with a pending roadmap directly to conversion", () => {
		rememberPendingRoadmap("roadmap-abc");
		rememberAuthContinuation({
			redirectTo: "/dashboard",
			source: "login",
			authMethod: "google",
		});

		expect(
			resolvePostAuthDestination({
				hasCompletedOnboarding: true,
			}),
		).toBe("/project/roadmap/convert/roadmap-abc");
	});

	it("sends incomplete users with a pending roadmap through welcome first", () => {
		rememberPendingRoadmap("roadmap-abc");

		expect(
			resolvePostAuthDestination({
				hasCompletedOnboarding: false,
			}),
		).toBe("/welcome");
	});

	it("uses an explicit redirect when there is no pending roadmap", () => {
		expect(
			resolvePostAuthDestination({
				explicitRedirect: "/project/invites/invite-1",
				hasCompletedOnboarding: true,
			}),
		).toBe("/project/invites/invite-1");
	});

	it("uses stored continuation when OAuth returns without query params", () => {
		rememberAuthContinuation({
			redirectTo: "/project/roadmap/convert/roadmap-1",
			source: "login",
			authMethod: "google",
		});

		expect(
			resolvePostAuthDestination({
				hasCompletedOnboarding: true,
			}),
		).toBe("/project/roadmap/convert/roadmap-1");
	});

	it("falls back to welcome for incomplete users without intent", () => {
		expect(
			resolvePostAuthDestination({
				hasCompletedOnboarding: false,
			}),
		).toBe("/welcome");
	});

	it("falls back to dashboard when there is no valid intent", () => {
		expect(resolvePostAuthDestination({ hasCompletedOnboarding: true })).toBe(
			"/dashboard",
		);
	});
});
