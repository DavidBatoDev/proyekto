import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Roadmap } from "@/types/roadmap";

// Mock the modules with side-effectful transitive imports (supabase client,
// axios instances) so the orchestration logic can run in a plain node env.
vi.mock("@/lib/guestAuth", () => ({
	getOrCreateGuestUser: vi.fn(),
}));
vi.mock("@/services/roadmap.service", () => ({
	roadmapService: {
		create: vi.fn(),
	},
}));
vi.mock("@/stores/authStore", () => ({
	useIsAuthenticated: vi.fn(),
	useIsLoading: vi.fn(),
}));

import { getOrCreateGuestUser } from "@/lib/guestAuth";
import { roadmapService } from "@/services/roadmap.service";
import {
	deriveRoadmapNameFromPrompt,
	HERO_GUEST_SESSION_ERROR,
	PENDING_AI_PROMPT_KEY_PREFIX,
	submitHeroPrompt,
} from "./HeroChatInput";

const sessionStore = new Map<string, string>();

beforeEach(() => {
	sessionStore.clear();
	vi.stubGlobal("sessionStorage", {
		getItem: (key: string) => sessionStore.get(key) ?? null,
		setItem: (key: string, value: string) => {
			sessionStore.set(key, String(value));
		},
		removeItem: (key: string) => {
			sessionStore.delete(key);
		},
	});
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("deriveRoadmapNameFromPrompt", () => {
	it("uses the prompt verbatim when it is short", () => {
		expect(deriveRoadmapNameFromPrompt("Build a booking app")).toBe(
			"Build a booking app",
		);
	});

	it("collapses whitespace and truncates long prompts to ~60 chars", () => {
		const prompt =
			"Build   a booking\napp for my tutoring business with payments, reminders and a client portal";
		const name = deriveRoadmapNameFromPrompt(prompt);
		expect(name.length).toBeLessThanOrEqual(61); // 60 chars + ellipsis
		expect(name.endsWith("…")).toBe(true);
		expect(name).not.toContain("\n");
		expect(name).not.toContain("  ");
	});

	it("falls back to 'New Roadmap' for blank prompts", () => {
		expect(deriveRoadmapNameFromPrompt("   ")).toBe("New Roadmap");
	});
});

describe("submitHeroPrompt", () => {
	it("mints a guest, creates an unlinked draft, writes the handoff key, then navigates", async () => {
		vi.mocked(getOrCreateGuestUser).mockResolvedValue("guest-user-1");
		vi.mocked(roadmapService.create).mockResolvedValue({
			id: "rm-1",
		} as Roadmap);
		const navigate = vi.fn(() => {
			// The handoff must be persisted BEFORE navigation fires so the roadmap
			// page can always consume it on mount.
			expect(sessionStore.get(`${PENDING_AI_PROMPT_KEY_PREFIX}rm-1`)).toBe(
				"Build a booking app",
			);
		});

		await submitHeroPrompt("Build a booking app", {
			isAuthenticated: false,
			navigate,
		});

		expect(getOrCreateGuestUser).toHaveBeenCalledTimes(1);
		expect(roadmapService.create).toHaveBeenCalledTimes(1);
		const createArg = vi.mocked(roadmapService.create).mock.calls[0][0];
		expect(createArg).toMatchObject({
			name: "Build a booking app",
			description: "",
			status: "draft",
			settings: {},
		});
		expect(createArg.preview_url).toMatch(/^data:image\/svg\+xml,/);
		// The hero always creates an UNLINKED draft — no project_id at all.
		expect("project_id" in createArg).toBe(false);
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenCalledWith({
			to: "/project/$projectId/roadmap/$roadmapId",
			params: { projectId: "n", roadmapId: "rm-1" },
		});
	});

	it("does not mint a guest when the visitor is authenticated", async () => {
		vi.mocked(roadmapService.create).mockResolvedValue({
			id: "rm-2",
		} as Roadmap);
		const navigate = vi.fn();

		await submitHeroPrompt("Launch an e-commerce store", {
			isAuthenticated: true,
			navigate,
		});

		expect(getOrCreateGuestUser).not.toHaveBeenCalled();
		expect(navigate).toHaveBeenCalledWith({
			to: "/project/$projectId/roadmap/$roadmapId",
			params: { projectId: "n", roadmapId: "rm-2" },
		});
	});

	it("surfaces a session error and stops when guest minting fails", async () => {
		vi.mocked(getOrCreateGuestUser).mockResolvedValue(null);
		const navigate = vi.fn();

		await expect(
			submitHeroPrompt("Idea", { isAuthenticated: false, navigate }),
		).rejects.toThrow(HERO_GUEST_SESSION_ERROR);

		expect(roadmapService.create).not.toHaveBeenCalled();
		expect(navigate).not.toHaveBeenCalled();
		expect(sessionStore.size).toBe(0);
	});

	it("maps a rejected guest mint to the same session error", async () => {
		vi.mocked(getOrCreateGuestUser).mockRejectedValue(new Error("network"));
		const navigate = vi.fn();

		await expect(
			submitHeroPrompt("Idea", { isAuthenticated: false, navigate }),
		).rejects.toThrow(HERO_GUEST_SESSION_ERROR);
	});

	it("propagates create failures without writing the handoff key or navigating", async () => {
		vi.mocked(getOrCreateGuestUser).mockResolvedValue("guest-user-1");
		vi.mocked(roadmapService.create).mockRejectedValue(
			new Error("create failed"),
		);
		const navigate = vi.fn();

		await expect(
			submitHeroPrompt("Idea", { isAuthenticated: false, navigate }),
		).rejects.toThrow("create failed");

		expect(navigate).not.toHaveBeenCalled();
		expect(sessionStore.size).toBe(0);
	});
});
