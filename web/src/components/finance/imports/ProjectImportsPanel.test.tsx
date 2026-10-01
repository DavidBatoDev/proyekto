/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	upload: vi.fn(),
}));

vi.mock("@/services/financeImports.service", () => ({
	financeImportsService: { list: mocks.list, upload: mocks.upload },
}));
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { ProjectImportsPanel } from "./ProjectImportsPanel";

const PROJECT_ID = "0f9619e4-0000-4000-8000-000000000000";

const refusal = (status: number) =>
	Object.assign(new Error(`Request failed with status code ${status}`), {
		response: {
			status,
			data: { message: "You don't have permission to view finance." },
		},
	});

function renderPanel(props: { canUpload?: boolean } = {}) {
	// No `retry` override: the panel's own policy is what is under test.
	const client = new QueryClient();
	return render(
		<QueryClientProvider client={client}>
			<ProjectImportsPanel
				projectId={PROJECT_ID}
				onOpenDocument={vi.fn()}
				{...props}
			/>
		</QueryClientProvider>,
	);
}

describe("ProjectImportsPanel", () => {
	beforeEach(() => {
		mocks.list.mockReset();
	});
	afterEach(cleanup);

	it.each([403, 404])(
		"renders the no-access state on a %i, asks once, and never says 'No documents yet'",
		async (status) => {
			mocks.list.mockRejectedValue(refusal(status));

			renderPanel();

			expect(
				await screen.findByText(
					"You don't have finance access to this project.",
				),
			).toBeTruthy();
			expect(
				screen.getByText("Ask the project owner for access."),
			).toBeTruthy();
			expect(screen.queryByText("No documents yet")).toBeNull();
			// The uploader goes too: no uploading into a ledger you cannot read.
			expect(screen.queryByText("Record past billing")).toBeNull();
			expect(mocks.list).toHaveBeenCalledTimes(1);
		},
	);

	it("renders a load error, not the empty state, when the list fails", async () => {
		mocks.list.mockRejectedValue(refusal(500));

		renderPanel();

		await waitFor(
			() => expect(screen.getByText("Couldn't load this")).toBeTruthy(),
			{ timeout: 8000 },
		);
		expect(screen.queryByText("No documents yet")).toBeNull();
	}, 10000);

	it("shows the empty state only for a real, empty answer", async () => {
		mocks.list.mockResolvedValue([]);

		renderPanel();

		expect(await screen.findByText("No documents yet")).toBeTruthy();
		expect(screen.getByText("Record past billing")).toBeTruthy();
	});

	it("hides the uploader from a reader without invoice management", async () => {
		mocks.list.mockResolvedValue([]);

		renderPanel({ canUpload: false });

		expect(await screen.findByText("No documents yet")).toBeTruthy();
		expect(screen.queryByText("Record past billing")).toBeNull();
	});
});
