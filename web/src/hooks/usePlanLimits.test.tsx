/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAN_LIMITS, normalizePlanLimits } from "@/lib/planLimits";
import { getPublicPlanLimits } from "@/services/entitlements.service";
import { usePublicPlanLimits } from "./usePlanLimits";

vi.mock("@/services/entitlements.service", () => ({
	getPublicPlanLimits: vi.fn(),
}));

const mockedGet = vi.mocked(getPublicPlanLimits);

const clients: QueryClient[] = [];

function wrapper() {
	// The hook asks for one retry; a zero delay keeps the failure case fast.
	const client = new QueryClient({
		defaultOptions: { queries: { retryDelay: 0 } },
	});
	clients.push(client);
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
}

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	mockedGet.mockReset();
});

function liveMatrix() {
	const limits = normalizePlanLimits(DEFAULT_PLAN_LIMITS);
	limits.free = {
		...limits.free,
		projects: { kind: "count", value: 3, per_seat: false, display_label: null },
	};
	return limits;
}

describe("usePublicPlanLimits", () => {
	it("renders the defaults before the fetch resolves", () => {
		mockedGet.mockReturnValue(new Promise(() => {}));
		const { result } = renderHook(() => usePublicPlanLimits(), {
			wrapper: wrapper(),
		});
		expect(result.current.limits).toBe(DEFAULT_PLAN_LIMITS);
		expect(result.current.isLive).toBe(false);
		expect(result.current.version).toBeNull();
	});

	it("switches to the live matrix once it arrives", async () => {
		const limits = liveMatrix();
		mockedGet.mockResolvedValue({
			limits,
			keys: [],
			version: "2026-09-22T00:00:00.000Z",
		});
		const { result } = renderHook(() => usePublicPlanLimits(), {
			wrapper: wrapper(),
		});
		await waitFor(() => expect(result.current.isLive).toBe(true));
		expect(result.current.limits).toBe(limits);
		expect(result.current.limits.free.projects).toMatchObject({ value: 3 });
		expect(result.current.version).toBe("2026-09-22T00:00:00.000Z");
	});

	it("keeps the defaults, not a blank table, when the service rejects", async () => {
		mockedGet.mockRejectedValue(new Error("503"));
		const { result } = renderHook(() => usePublicPlanLimits(), {
			wrapper: wrapper(),
		});
		// One retry, then the query settles in error.
		await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(result.current.limits).toBe(DEFAULT_PLAN_LIMITS);
		expect(result.current.isLive).toBe(false);
	});
});
