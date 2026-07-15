/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketplaceRoadmapPrompt } from "./MarketplaceRoadmapPrompt";

const { createRoadmapIntakeDraft, navigate } = vi.hoisted(() => ({
	createRoadmapIntakeDraft: vi.fn(),
	navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
}));

vi.mock("@/lib/roadmapIntakeDraft", () => ({
	createRoadmapIntakeDraft,
}));

beforeEach(() => {
	vi.clearAllMocks();
	createRoadmapIntakeDraft.mockReturnValue("draft-marketplace-1");
	navigate.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("MarketplaceRoadmapPrompt", () => {
	it("creates a standalone marketplace draft and opens AI intake", async () => {
		render(<MarketplaceRoadmapPrompt />);

		const prompt = screen.getByLabelText("Describe what you want to build");
		const submit = screen.getByRole("button", {
			name: "Build roadmap with AI",
		});
		expect((submit as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(prompt, { target: { value: "  Build a tutoring app  " } });
		fireEvent.click(submit);

		await waitFor(() => {
			expect(createRoadmapIntakeDraft).toHaveBeenCalledWith({
				prompt: "Build a tutoring app",
				source: "marketplace",
				projectId: "n",
			});
		});
		expect(navigate).toHaveBeenCalledWith({
			to: "/project/$projectId/roadmap/create",
			params: { projectId: "n" },
			search: { draftId: "draft-marketplace-1" },
		});
	});

	it("submits with Enter and keeps Shift+Enter for a new line", async () => {
		render(<MarketplaceRoadmapPrompt />);
		const prompt = screen.getByLabelText("Describe what you want to build");
		fireEvent.change(prompt, {
			target: { value: "Build an analytics portal" },
		});

		fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });
		expect(createRoadmapIntakeDraft).not.toHaveBeenCalled();

		fireEvent.keyDown(prompt, { key: "Enter" });
		await waitFor(() =>
			expect(createRoadmapIntakeDraft).toHaveBeenCalledOnce(),
		);
	});

	it("restores submission after a navigation failure", async () => {
		navigate.mockRejectedValueOnce(new Error("navigation failed"));
		const errorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		render(<MarketplaceRoadmapPrompt />);

		fireEvent.change(screen.getByLabelText("Describe what you want to build"), {
			target: { value: "Build a customer portal" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Build roadmap with AI" }),
		);

		expect(
			await screen.findByText(
				"We could not start your AI roadmap. Please try again.",
			),
		).toBeTruthy();
		expect(
			(
				screen.getByRole("button", {
					name: "Build roadmap with AI",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
		errorSpy.mockRestore();
	});
});
