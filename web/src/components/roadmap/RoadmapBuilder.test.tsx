/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoadmapBuilder } from "./RoadmapBuilder";

const navigateMock = vi.hoisted(() => vi.fn());
const suggestIntakeStepMock = vi.hoisted(() => vi.fn());
const readRoadmapIntakeDraftMock = vi.hoisted(() => vi.fn());
const clearRoadmapIntakeDraftMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

vi.mock("@/stores/authStore", () => ({
	useIsLoading: () => false,
	useUser: () => null,
}));

vi.mock("@/lib/roadmapIntakeDraft", () => ({
	clearRoadmapIntakeDraft: clearRoadmapIntakeDraftMock,
	readRoadmapIntakeDraft: readRoadmapIntakeDraftMock,
}));

vi.mock("@/services/roadmap.service", () => ({
	roadmapService: {
		suggestIntakeStep: suggestIntakeStepMock,
	},
}));

vi.mock("@/services/upload.service", () => ({
	uploadService: {
		upload: vi.fn(),
	},
}));

vi.mock("@/lib/guestAuth", () => ({
	getOrCreateGuestUser: vi.fn(),
}));

vi.mock("@/lib/roadmapThumbnail", () => ({
	generateRoadmapThumbnailDataUri: vi.fn(() => "data:image/svg+xml,test"),
}));

beforeEach(() => {
	vi.clearAllMocks();
	Element.prototype.scrollIntoView = vi.fn();
	readRoadmapIntakeDraftMock.mockReturnValue({
		prompt: "hi",
		source: "hero",
		createdAt: new Date().toISOString(),
	});
});

afterEach(() => {
	cleanup();
});

function renderBuilder() {
	return render(<RoadmapBuilder projectId="n" draftId="draft-1" embedded />);
}

describe("RoadmapBuilder objective intake", () => {
	it("uses semantic theme colors for the initial roadmap prompt", () => {
		readRoadmapIntakeDraftMock.mockReturnValue(null);

		renderBuilder();

		const prompt = screen.getByLabelText(
			"What should this roadmap help you build?",
		);
		const promptCard = prompt.closest("section");
		const submitButton = screen.getByRole("button", { name: "Send to AI" });

		expect(prompt.className).toContain("bg-muted/40");
		expect(prompt.className).toContain("text-foreground");
		expect(promptCard?.className).toContain("bg-card");
		expect(promptCard?.className).toContain("border-border");
		expect(submitButton.className).toContain("bg-primary");
		expect(promptCard?.className).not.toContain("bg-white");
	});

	it("hides the prompt input while the first objective check is thinking", async () => {
		suggestIntakeStepMock.mockReturnValue(new Promise(() => undefined));

		renderBuilder();

		await waitFor(() => {
			expect(screen.getByText("Thinking")).toBeTruthy();
		});
		expect(
			screen.queryByText("What should this roadmap help you build?"),
		).toBeNull();
	});

	it("asks for clarification instead of title options for a weak prompt", async () => {
		suggestIntakeStepMock.mockResolvedValueOnce({
			objective_decision: "clarify",
			assistant_message:
				"What are you building, who is it for, and what should v1 include?",
			options: [],
		});

		renderBuilder();

		await waitFor(() => {
			expect(screen.getByText("Add the missing project details")).toBeTruthy();
		});
		expect(suggestIntakeStepMock).toHaveBeenCalledWith(
			expect.objectContaining({
				step: "objective",
				prompt: "hi",
			}),
		);
		expect(screen.queryByText("Or name it yourself")).toBeNull();
	});

	it("continues to title suggestions once the objective is ready", async () => {
		readRoadmapIntakeDraftMock.mockReturnValue({
			prompt:
				"Build a fitness web app for older adults with onboarding and reminders",
			source: "hero",
			createdAt: new Date().toISOString(),
		});
		suggestIntakeStepMock.mockImplementation((payload: { step: string }) => {
			if (payload.step === "objective") {
				return Promise.resolve({
					objective_decision: "ready",
					assistant_message: "Great, I understand the project objective.",
					refined_prompt:
						"Build a fitness web app for older adults with onboarding and reminders.",
					audience: "older adults",
					scope: "onboarding and reminders",
					options: [],
				});
			}
			return Promise.resolve({
				assistant_message: "What should we call this roadmap?",
				options: [
					{ key: "A", value: "PulseCoach Platform" },
					{ key: "B", value: "Momentum Fitness Hub" },
					{ key: "C", value: "Senior Fitness Companion" },
				],
			});
		});

		renderBuilder();

		await waitFor(() => {
			expect(screen.getByText("PulseCoach Platform")).toBeTruthy();
		});
		expect(suggestIntakeStepMock).toHaveBeenCalledWith(
			expect.objectContaining({
				step: "title",
				prompt:
					"Build a fitness web app for older adults with onboarding and reminders.",
			}),
		);
		expect(screen.getByText(/Objective locked/)).toBeTruthy();
	});

	it("does not ask for clarification when the prompt already has detailed scope", async () => {
		readRoadmapIntakeDraftMock.mockReturnValue({
			prompt:
				"Build a full-stack fitness platform with authentication, workout tracking, analytics dashboards, notifications, API, database, and deployment pipeline",
			source: "hero",
			createdAt: new Date().toISOString(),
		});
		suggestIntakeStepMock.mockImplementation((payload: { step: string }) => {
			if (payload.step === "objective") {
				return Promise.resolve({
					objective_decision: "ready",
					assistant_message: "Great, I understand the project objective.",
					refined_prompt:
						"Build a full-stack fitness platform with authentication, workout tracking, analytics dashboards, notifications, API, database, and deployment pipeline",
					audience: "target users",
					scope:
						"authentication, workout tracking, analytics dashboards, notifications, API, database, and deployment pipeline",
					options: [],
				});
			}
			return Promise.resolve({
				assistant_message: "What should we call this roadmap?",
				options: [
					{ key: "A", value: "FitStack Platform" },
					{ key: "B", value: "TrainingOS Blueprint" },
					{ key: "C", value: "PulseOps Roadmap" },
				],
			});
		});

		renderBuilder();

		await waitFor(() => {
			expect(screen.getByText("FitStack Platform")).toBeTruthy();
		});
		expect(screen.queryByText("Add the missing project details")).toBeNull();
	});

	it("cancels and redirects home when clarification is still ambiguous", async () => {
		suggestIntakeStepMock
			.mockResolvedValueOnce({
				objective_decision: "clarify",
				assistant_message:
					"What are you building, who is it for, and what should v1 include?",
				options: [],
			})
			.mockResolvedValueOnce({
				objective_decision: "cancel",
				assistant_message:
					"No worries, I will cancel this roadmap setup for now.",
				options: [],
			});

		renderBuilder();

		const clarificationInput = await screen.findByLabelText(
			"Add the missing project details",
		);
		fireEvent.change(clarificationInput, {
			target: { value: "still testing" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		await waitFor(
			() => {
				expect(clearRoadmapIntakeDraftMock).toHaveBeenCalledWith("draft-1");
				expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
			},
			{ timeout: 1500 },
		);
	});
});
