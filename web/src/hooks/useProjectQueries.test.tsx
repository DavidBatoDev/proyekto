/* @vitest-environment jsdom */

/**
 * `useProjectMyPermissionsQuery` (W3-1b): a refusal is an answer, so it is
 * never retried; any other failure gets one retry, as before.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/apiErrors";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("@/queries/project", () => ({
	projectKeys: {
		myPermissions: (projectId: string) =>
			["project", projectId, "my-permissions"] as const,
	},
	fetchMyProjectPermissions: mocks.fetch,
}));
vi.mock("@/services/project.service", () => ({ projectService: {} }));

import { useProjectMyPermissionsQuery } from "./useProjectQueries";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderPermissions() {
	// No backoff, so the one retry happens at once.
	client = new QueryClient({
		defaultOptions: { queries: { retryDelay: 0 } },
	});
	return renderHook(() => useProjectMyPermissionsQuery("p1"), { wrapper });
}

afterEach(() => {
	client?.clear();
	mocks.fetch.mockReset();
});

describe("useProjectMyPermissionsQuery", () => {
	it.each([401, 403, 404])(
		"settles a %i refusal at once, with no retry",
		async (status) => {
			mocks.fetch.mockRejectedValue(new ApiError("Not yours", status));
			const { result } = renderPermissions();
			await waitFor(() => expect(result.current.isError).toBe(true));
			expect(mocks.fetch).toHaveBeenCalledTimes(1);
			expect((result.current.error as ApiError).status).toBe(status);
		},
	);

	it("retries any other failure once", async () => {
		mocks.fetch.mockRejectedValue(new ApiError("Bad gateway", 502));
		const { result } = renderPermissions();
		await waitFor(() => expect(result.current.isError).toBe(true));
		expect(mocks.fetch).toHaveBeenCalledTimes(2);
	});

	it("recovers when the retry answers", async () => {
		mocks.fetch
			.mockRejectedValueOnce(new TypeError("Failed to fetch"))
			.mockResolvedValueOnce({ role: "editor" });
		const { result } = renderPermissions();
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual({ role: "editor" });
		expect(mocks.fetch).toHaveBeenCalledTimes(2);
		expect(mocks.fetch).toHaveBeenCalledWith("p1");
	});
});
