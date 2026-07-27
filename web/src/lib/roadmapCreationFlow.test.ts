import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/guestAuth", () => ({
	getOrCreateGuestUser: vi.fn(),
}));
vi.mock("@/lib/guestRoadmapConversion", () => ({
	rememberGuestRoadmap: vi.fn(),
}));
vi.mock("@/lib/roadmapPageHandoff", () => ({
	setPendingRoadmapAiPrompt: vi.fn(),
	setPendingRoadmapMetadataModal: vi.fn(),
}));
vi.mock("@/lib/roadmapThumbnail", () => ({
	generateRoadmapThumbnailDataUri: vi.fn(() => "data:image/svg+xml,test"),
}));
vi.mock("@/services/roadmap.service", () => ({
	roadmapService: {
		create: vi.fn(),
		suggestMetadata: vi.fn(),
	},
}));

import { getOrCreateGuestUser } from "@/lib/guestAuth";
import { rememberGuestRoadmap } from "@/lib/guestRoadmapConversion";
import {
	setPendingRoadmapAiPrompt,
	setPendingRoadmapMetadataModal,
} from "@/lib/roadmapPageHandoff";
import { roadmapService } from "@/services/roadmap.service";
import {
	buildFallbackRoadmapMetadata,
	buildRoadmapCreatePayload,
	buildRoadmapPlanningPrompt,
	createRoadmapFromIdea,
	deriveRoadmapNameFromPrompt,
} from "./roadmapCreationFlow";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("roadmapCreationFlow", () => {
	it("derives concise fallback metadata from the prompt", () => {
		expect(deriveRoadmapNameFromPrompt("Build   an AI\nchatbot")).toBe(
			"Build an AI chatbot",
		);
		expect(buildFallbackRoadmapMetadata("Build an AI support chatbot")).toEqual(
			{
				name: "Build an AI support chatbot",
				description: "Roadmap for Build an AI support chatbot.",
				category: "AI / ML",
			},
		);
	});

	it("builds a roadmap create payload and only attaches real project ids", () => {
		const payload = buildRoadmapCreatePayload({
			projectId: "project-1",
			metadata: {
				name: " Fitness Buddy ",
				description: " A fitness roadmap ",
				category: " Health & Fitness ",
			},
		});

		expect(payload).toEqual({
			name: "Fitness Buddy",
			description: "A fitness roadmap",
			category: "Health & Fitness",
			status: "draft",
			settings: {},
			preview_url: "data:image/svg+xml,test",
			project_id: "project-1",
		});

		expect(
			buildRoadmapCreatePayload({
				projectId: "n",
				metadata: {
					name: "Guest Roadmap",
					description: "",
					category: "SaaS",
				},
			}).project_id,
		).toBeUndefined();
	});

	it("creates a guest roadmap, remembers it, and prepares page handoffs", async () => {
		vi.mocked(getOrCreateGuestUser).mockResolvedValue("guest-1");
		vi.mocked(roadmapService.suggestMetadata).mockResolvedValue({
			name: "Fitness Buddy",
			description: "Plan a fitness app.",
			category: "Health & Fitness",
		});
		vi.mocked(roadmapService.create).mockResolvedValue({
			id: "roadmap-1",
			name: "Fitness Buddy",
		} as Awaited<ReturnType<typeof createRoadmapFromIdea>>);

		const roadmap = await createRoadmapFromIdea({
			prompt: "I want to create a fitness app",
			projectId: "n",
			isAuthenticated: false,
		});

		expect(roadmap.id).toBe("roadmap-1");
		expect(getOrCreateGuestUser).toHaveBeenCalledOnce();
		expect(roadmapService.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Fitness Buddy",
				category: "Health & Fitness",
			}),
		);
		expect(rememberGuestRoadmap).toHaveBeenCalledWith({
			roadmapId: "roadmap-1",
			title: "Fitness Buddy",
		});
		expect(setPendingRoadmapAiPrompt).toHaveBeenCalledWith(
			"roadmap-1",
			expect.stringContaining("Original idea: I want to create a fitness app"),
		);
		expect(setPendingRoadmapAiPrompt).toHaveBeenCalledWith(
			"roadmap-1",
			expect.stringContaining("Roadmap title: Fitness Buddy"),
		);
		expect(setPendingRoadmapAiPrompt).toHaveBeenCalledWith(
			"roadmap-1",
			expect.stringContaining("Categories: Health & Fitness"),
		);
		expect(setPendingRoadmapMetadataModal).toHaveBeenCalledWith("roadmap-1");
	});

	it("folds captured intake slots into the agent planning prompt", () => {
		const prompt = buildRoadmapPlanningPrompt({
			metadata: {
				name: "PulseCoach",
				description: "A fitness roadmap",
				category: "Health & Fitness",
			},
			prompt: "A fitness app",
			intake: {
				product: "fitness mobile app",
				audience: "adults 65+ living independently",
				features: ["Workout plans", "Reminders"],
				platform: "Mobile",
				constraints: "Ship an MVP in 8 weeks",
			},
		});

		expect(prompt).toContain("Audience: adults 65+ living independently");
		expect(prompt).toContain("Platform: Mobile");
		expect(prompt).toContain(
			"Must-have v1 capabilities: Workout plans, Reminders",
		);
		expect(prompt).toContain("Constraints: Ship an MVP in 8 weeks");
	});

	it("omits intake lines entirely when no slots were captured", () => {
		const prompt = buildRoadmapPlanningPrompt({
			metadata: {
				name: "PulseCoach",
				description: "A fitness roadmap",
				category: "Health & Fitness",
			},
			prompt: "A fitness app",
		});

		expect(prompt).not.toContain("Audience:");
		expect(prompt).not.toContain("Must-have v1 capabilities:");
		expect(prompt).toContain(
			"Create the roadmap epics, features, and tasks from this context.",
		);
	});
});
