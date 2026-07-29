/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.hoisted(() => vi.fn());
const suggestIntakeStepMock = vi.hoisted(() => vi.fn());
const readRoadmapIntakeDraftMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateMock }));
vi.mock("@/stores/authStore", () => ({
	useIsLoading: () => false,
	useUser: () => ({ id: "user-1" }),
}));
vi.mock("@/lib/roadmapIntakeDraft", () => ({
	clearRoadmapIntakeDraft: vi.fn(),
	readRoadmapIntakeDraft: readRoadmapIntakeDraftMock,
}));
vi.mock("@/services/roadmap.service", () => ({
	roadmapService: { suggestIntakeStep: suggestIntakeStepMock },
}));
vi.mock("@/services/upload.service", () => ({
	uploadService: { upload: vi.fn() },
}));
vi.mock("@/lib/guestAuth", () => ({ getOrCreateGuestUser: vi.fn() }));
vi.mock("@/lib/roadmapThumbnail", () => ({
	generateRoadmapThumbnailDataUri: vi.fn(() => "data:image/svg+xml,GRADIENT"),
}));

// The whole point of this file: exercise the flag ON. Everything else about
// the flow is mocked, so a failure here is the cover-image wiring and nothing
// else. The real manifest is used deliberately - if a seed run ever empties a
// pool, this test should notice.
vi.mock("@/config/featureFlags", () => ({
	featureFlags: { stockPhotos: true },
}));

const { RoadmapBuilder } = await import("./RoadmapBuilder");

beforeEach(() => {
	vi.clearAllMocks();
	Element.prototype.scrollIntoView = vi.fn();
	readRoadmapIntakeDraftMock.mockReturnValue({
		prompt: "Build a SaaS launch system for startup teams",
		source: "hero",
		createdAt: new Date().toISOString(),
	});
	suggestIntakeStepMock.mockImplementation((payload: { step: string }) => {
		if (payload.step === "objective") {
			return Promise.resolve({
				objective_decision: "ready",
				assistant_message: "Understood.",
				refined_prompt: "Build a SaaS launch system for startup teams.",
				options: [],
			});
		}
		if (payload.step === "title") {
			return Promise.resolve({
				assistant_message: "What should we call it?",
				options: [{ key: "A", value: "SaaS Launch System" }],
			});
		}
		return Promise.resolve({
			assistant_message: "What is the goal?",
			options: [
				{ key: "A", value: "Ship the first release of SaaS Launch System." },
			],
			categories: ["EdTech", "SaaS", "Collaboration Tools"],
		});
	});
});

afterEach(cleanup);

/** Walks the mocked intake to the final "thumbnail" step. */
async function reachThumbnailStep() {
	render(<RoadmapBuilder projectId="n" draftId="draft-1" embedded />);

	await waitFor(() =>
		expect(screen.getByText("SaaS Launch System")).toBeTruthy(),
	);
	fireEvent.click(screen.getByText("SaaS Launch System"));

	await waitFor(() =>
		expect(
			screen.getByText("Ship the first release of SaaS Launch System."),
		).toBeTruthy(),
	);
	fireEvent.click(
		screen.getByText("Ship the first release of SaaS Launch System."),
	);

	const continueButton = await screen.findByRole("button", {
		name: /Continue|Looks good/i,
	});
	fireEvent.click(continueButton);

	await waitFor(
		() => expect(screen.getByText(/Final metadata/i)).toBeTruthy(),
		{
			timeout: 4000,
		},
	);
}

describe("RoadmapBuilder cover image", () => {
	it("renders a curated CDN photo instead of the generated gradient", async () => {
		await reachThumbnailStep();

		const preview = screen.getByAltText(
			"Roadmap thumbnail preview",
		) as HTMLImageElement;

		expect(preview.src).toMatch(
			/^https:\/\/cdn\.proyekto\.tech\/stock\/[a-z-]+\/\d{2}\.jpg$/,
		);
		expect(preview.src).not.toContain("data:image/svg+xml");
	});

	it("labels it as a cover image and offers Shuffle", async () => {
		await reachThumbnailStep();

		expect(screen.getByText("Cover image")).toBeTruthy();
		expect(screen.queryByText("Generated thumbnail")).toBeNull();
		expect(screen.getByRole("button", { name: /Shuffle image/i })).toBeTruthy();
	});

	it("Shuffle advances to a different photo in the same theme", async () => {
		await reachThumbnailStep();

		const img = () =>
			(screen.getByAltText("Roadmap thumbnail preview") as HTMLImageElement)
				.src;
		const before = img();

		fireEvent.click(screen.getByRole("button", { name: /Shuffle image/i }));

		await waitFor(() => expect(img()).not.toBe(before));
		// Same theme directory, different file.
		expect(img().split("/").slice(0, -1).join("/")).toBe(
			before.split("/").slice(0, -1).join("/"),
		);
	});
});
