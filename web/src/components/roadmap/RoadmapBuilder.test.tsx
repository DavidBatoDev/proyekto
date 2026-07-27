/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
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
		const userBubble = screen.getByText("hi").parentElement;
		expect(userBubble?.className).not.toContain("before:");
		expect(userBubble?.className).not.toContain("rounded-br-md");
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
		fireEvent.keyDown(clarificationInput, { key: "Enter", shiftKey: true });
		expect(suggestIntakeStepMock).toHaveBeenCalledTimes(1);
		fireEvent.keyDown(clarificationInput, { key: "Enter" });

		await waitFor(
			() => {
				expect(clearRoadmapIntakeDraftMock).toHaveBeenCalledWith("draft-1");
				expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
			},
			{ timeout: 1500 },
		);
	});
});

describe("RoadmapBuilder guided intake", () => {
	const clarifyResponse = {
		objective_decision: "clarify",
		assistant_message: "Two quick questions.",
		options: [],
		can_build_anyway: true,
		round: 1,
		captured: { product: "fitness mobile app" },
		questions: [
			{
				id: "audience",
				header: "Who for",
				question: "Who are the primary users?",
				multi_select: false,
				allow_custom: true,
				options: [
					{ label: "Adults 65+ living independently" },
					{ label: "Assisted-living residents" },
				],
			},
		],
	};

	it("renders a clickable clarifier card instead of the free-text textarea", async () => {
		suggestIntakeStepMock.mockResolvedValue(clarifyResponse);

		renderBuilder();

		await waitFor(() => {
			expect(screen.getByTestId("clarifier-card")).toBeTruthy();
		});
		expect(screen.getAllByTestId("clarifier-option").length).toBeGreaterThan(1);
		expect(screen.queryByText("Add the missing project details")).toBeNull();
	});

	it("keeps the slot progress strip visible during clarification", async () => {
		suggestIntakeStepMock.mockResolvedValue(clarifyResponse);

		renderBuilder();

		const strip = await screen.findByTestId("intake-slot-strip");
		expect(strip).toBeTruthy();
		const productChip = screen
			.getAllByTestId("intake-slot-chip")
			.find((chip) => chip.getAttribute("data-slot") === "product");
		expect(productChip?.getAttribute("data-filled")).toBe("true");
	});

	it("uses only theme tokens on the slot progress strip", async () => {
		suggestIntakeStepMock.mockResolvedValue(clarifyResponse);

		renderBuilder();

		const strip = await screen.findByTestId("intake-slot-strip");
		expect(strip.className).toContain("bg-card");
		expect(strip.className).toContain("border-border");
		expect(strip.className).not.toContain("bg-white");
	});

	it("sends the prior assistant question and the answers as turns", async () => {
		suggestIntakeStepMock.mockResolvedValue(clarifyResponse);

		renderBuilder();

		await waitFor(() => {
			expect(screen.getByTestId("clarifier-card")).toBeTruthy();
		});

		// Click the radio itself - a label click does not toggle it under jsdom.
		const firstOption = screen
			.getAllByTestId("clarifier-option")[0]
			.querySelector("input");
		if (!firstOption) throw new Error("clarifier option input not found");
		fireEvent.click(firstOption);
		// Wait for the selection to commit - clicking submit before React has
		// re-rendered leaves the button disabled and silently drops the answer.
		await waitFor(() => {
			expect(
				(screen.getByTestId("clarifier-submit") as HTMLButtonElement).disabled,
			).toBe(false);
		});
		fireEvent.click(screen.getByTestId("clarifier-submit"));

		await waitFor(() => {
			expect(suggestIntakeStepMock).toHaveBeenCalledTimes(2);
		});

		const secondCall = suggestIntakeStepMock.mock.calls[1][0];
		// The repeat-question fix: the assistant's own question goes back up.
		expect(secondCall.turns[0]).toEqual({
			role: "assistant",
			content: "Two quick questions.",
		});
		expect(secondCall.turns[1].role).toBe("user");
		expect(secondCall.turns[1].content).toContain("Who are the primary users?");
		expect(secondCall.turns[1].content).toContain(
			"Adults 65+ living independently",
		);
		expect(secondCall.captured).toEqual({ product: "fitness mobile app" });
		expect(secondCall.round).toBe(1);
	});

	it("offers build-it-anyway and forces ready when clicked", async () => {
		suggestIntakeStepMock.mockResolvedValue(clarifyResponse);

		renderBuilder();

		const buildAnyway = await screen.findByTestId("intake-build-anyway");
		fireEvent.click(buildAnyway);

		await waitFor(() => {
			expect(suggestIntakeStepMock).toHaveBeenCalledTimes(2);
		});
		expect(suggestIntakeStepMock.mock.calls[1][0].force_ready).toBe(true);
	});

	it("lets the user escape the options into free text", async () => {
		suggestIntakeStepMock.mockResolvedValue(clarifyResponse);

		renderBuilder();

		const toggle = await screen.findByTestId("intake-free-text-toggle");
		fireEvent.click(toggle);

		expect(
			screen.getByLabelText("Add the missing project details"),
		).toBeTruthy();
		expect(screen.queryByTestId("clarifier-card")).toBeNull();
	});

	it("falls back to the textarea when the backend returns no questions", async () => {
		// Backend flag still off: the response carries no `questions`.
		suggestIntakeStepMock.mockResolvedValue({
			objective_decision: "clarify",
			assistant_message: "Tell me more.",
			options: [],
		});

		renderBuilder();

		expect(
			await screen.findByLabelText("Add the missing project details"),
		).toBeTruthy();
		expect(screen.queryByTestId("clarifier-card")).toBeNull();
	});

	it("keeps the original prompt intact when answering in free text", async () => {
		suggestIntakeStepMock.mockResolvedValue({
			objective_decision: "clarify",
			assistant_message: "Tell me more.",
			options: [],
		});

		renderBuilder();

		const input = await screen.findByLabelText(
			"Add the missing project details",
		);
		fireEvent.change(input, { target: { value: "Fitness for older people" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() => {
			expect(suggestIntakeStepMock).toHaveBeenCalledTimes(2);
		});
		const secondCall = suggestIntakeStepMock.mock.calls[1][0];
		// The old path mangled these into one "prompt\nAdditional detail:" blob.
		expect(secondCall.prompt).toBe("hi");
		expect(secondCall.turns).toContainEqual({
			role: "user",
			content: "Fitness for older people",
		});
	});
});
