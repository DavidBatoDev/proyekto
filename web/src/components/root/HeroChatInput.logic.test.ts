import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/roadmapIntakeDraft", () => ({
	createRoadmapIntakeDraft: vi.fn(),
}));

import { createRoadmapIntakeDraft } from "@/lib/roadmapIntakeDraft";
import {
	deriveRoadmapNameFromPrompt,
	PENDING_AI_PROMPT_KEY_PREFIX,
	submitHeroPrompt,
} from "./HeroChatInput";

beforeEach(() => {
	vi.clearAllMocks();
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
		expect(name.length).toBeLessThanOrEqual(63); // 60 chars + "..."
		expect(name.endsWith("...")).toBe(true);
		expect(name).not.toContain("\n");
		expect(name).not.toContain("  ");
	});

	it("falls back to 'New Roadmap' for blank prompts", () => {
		expect(deriveRoadmapNameFromPrompt("   ")).toBe("New Roadmap");
	});
});

describe("submitHeroPrompt", () => {
	it("creates an intake draft, then navigates to the chat-style setup page", async () => {
		vi.mocked(createRoadmapIntakeDraft).mockReturnValue("draft-1");
		const navigate = vi.fn();

		await submitHeroPrompt("Build a booking app", { navigate });

		expect(createRoadmapIntakeDraft).toHaveBeenCalledWith({
			prompt: "Build a booking app",
			source: "hero",
			projectId: "n",
		});
		expect(navigate).toHaveBeenCalledWith({
			to: "/project/$projectId/roadmap/create",
			params: { projectId: "n" },
			search: { draftId: "draft-1" },
		});
	});

	it("keeps the roadmap AI handoff prefix stable", () => {
		expect(PENDING_AI_PROMPT_KEY_PREFIX).toBe("proyekto_pending_ai_prompt:");
	});
});
