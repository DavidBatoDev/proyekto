/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoadmapStartDialog } from "./RoadmapStartDialog";

const { navigate, createRoadmapFromMetadata } = vi.hoisted(() => ({
	navigate: vi.fn(),
	createRoadmapFromMetadata: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

vi.mock("@/lib/roadmapCreationFlow", () => ({
	createRoadmapFromMetadata,
	DEFAULT_ROADMAP_NAME: "New Roadmap",
	DEFAULT_ROADMAP_CATEGORY: "Web Development",
}));

const { invalidateProjectLinkedRoadmap } = vi.hoisted(() => ({
	invalidateProjectLinkedRoadmap: vi.fn(),
}));

vi.mock("@/hooks/dashboardInvalidation", () => ({
	invalidateDashboardRoadmaps: vi.fn(),
	invalidateProjectLinkedRoadmap,
}));

vi.mock("@/stores/authStore", () => ({ useUser: () => ({ id: "user-1" }) }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderDialog(onClose = vi.fn(), projectId?: string) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<RoadmapStartDialog open onClose={onClose} projectId={projectId} />
		</QueryClientProvider>,
	);
	return onClose;
}

describe("RoadmapStartDialog", () => {
	it("offers the guided, blank, and template routes", () => {
		renderDialog();

		expect(
			screen.getByRole("button", {
				name: /start a roadmap with the help of ai/i,
			}),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /start the roadmap immediately/i }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /browse popular roadmaps/i }),
		).toBeTruthy();
	});

	it("sends the AI route to the builder without creating anything", () => {
		const onClose = renderDialog();

		fireEvent.click(
			screen.getByRole("button", {
				name: /start a roadmap with the help of ai/i,
			}),
		);

		expect(navigate).toHaveBeenCalledWith({
			to: "/project/$projectId/roadmap/create",
			params: { projectId: "n" },
			search: { draftId: undefined },
		});
		expect(createRoadmapFromMetadata).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});

	it("sends the template route to the gallery without creating anything", () => {
		renderDialog();

		fireEvent.click(
			screen.getByRole("button", { name: /browse popular roadmaps/i }),
		);

		expect(navigate).toHaveBeenCalledWith({ to: "/roadmap-templates" });
		expect(createRoadmapFromMetadata).not.toHaveBeenCalled();
	});

	it("creates a blank roadmap and opens it when starting immediately", async () => {
		createRoadmapFromMetadata.mockResolvedValue({ id: "roadmap-9" });
		renderDialog();

		fireEvent.click(
			screen.getByRole("button", { name: /start the roadmap immediately/i }),
		);

		await waitFor(() => {
			expect(navigate).toHaveBeenCalledWith({
				to: "/project/$projectId/roadmap/$roadmapId",
				params: { projectId: "n", roadmapId: "roadmap-9" },
			});
		});

		// No prompt, or the agent starts generating epics the author never asked
		// for; the metadata modal opens so "New Roadmap" is not the final name.
		const args = createRoadmapFromMetadata.mock.calls[0][0];
		expect(args.prompt).toBe("");
		expect(args.openMetadataModal).toBe(true);
		expect(args.projectId).toBe("n");
	});

	describe("opened from a project", () => {
		it("sends the AI route to the project's builder", () => {
			renderDialog(vi.fn(), "proj-1");

			fireEvent.click(
				screen.getByRole("button", {
					name: /start a roadmap with the help of ai/i,
				}),
			);

			expect(navigate).toHaveBeenCalledWith({
				to: "/project/$projectId/roadmap/create",
				params: { projectId: "proj-1" },
				search: { draftId: undefined },
			});
		});

		it("carries the project into the template gallery", () => {
			renderDialog(vi.fn(), "proj-1");

			fireEvent.click(
				screen.getByRole("button", { name: /browse popular roadmaps/i }),
			);

			expect(navigate).toHaveBeenCalledWith({
				to: "/roadmap-templates",
				search: { projectId: "proj-1" },
			});
			expect(createRoadmapFromMetadata).not.toHaveBeenCalled();
		});

		it("creates the blank roadmap on the project and refreshes its link", async () => {
			createRoadmapFromMetadata.mockResolvedValue({ id: "roadmap-9" });
			renderDialog(vi.fn(), "proj-1");

			fireEvent.click(
				screen.getByRole("button", { name: /start the roadmap immediately/i }),
			);

			await waitFor(() => {
				expect(navigate).toHaveBeenCalledWith({
					to: "/project/$projectId/roadmap/$roadmapId",
					params: { projectId: "proj-1", roadmapId: "roadmap-9" },
				});
			});
			expect(createRoadmapFromMetadata.mock.calls[0][0].projectId).toBe(
				"proj-1",
			);
			// The project shell reads ["project", "linked-roadmap", id] with a
			// 60s staleTime; without this it would not know the roadmap exists.
			expect(invalidateProjectLinkedRoadmap).toHaveBeenCalledWith(
				expect.anything(),
				"proj-1",
			);
		});
	});

	it("keeps the dialog open and explains itself when creation fails", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		createRoadmapFromMetadata.mockRejectedValue(new Error("nope"));
		const onClose = renderDialog();

		fireEvent.click(
			screen.getByRole("button", { name: /start the roadmap immediately/i }),
		);

		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(navigate).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});
});
