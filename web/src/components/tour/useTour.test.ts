/* @vitest-environment jsdom */

/**
 * Regression cover for a silent failure: the runtime originally listened for
 * TOUR_STATUS, which Joyride only emits on the STOP and RESET actions. The
 * tour therefore ran and looked fine while never recording anything, so it
 * re-offered itself forever. These tests pin the terminal event.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { EVENTS, STATUS } from "react-joyride";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	fetchTourProgress,
	hasSeenTourLocally,
	markTourSeenLocally,
	recordTourProgress,
	recordTourReplay,
} = vi.hoisted(() => ({
	fetchTourProgress: vi.fn(),
	hasSeenTourLocally: vi.fn(),
	markTourSeenLocally: vi.fn(),
	recordTourProgress: vi.fn(),
	recordTourReplay: vi.fn(),
}));

vi.mock("@/queries/tours", () => ({
	fetchTourProgress,
	hasSeenTourLocally,
	markTourSeenLocally,
	recordTourProgress,
	recordTourReplay,
	tourKeys: {
		all: ["tours"],
		byUser: (userId: string) => ["tours", userId],
		progress: (userId: string, tourKey: string) => ["tours", userId, tourKey],
	},
}));

vi.mock("@/stores/authStore", () => ({
	useAuthStore: (selector: (state: unknown) => unknown) =>
		selector({ user: { id: "user-1" } }),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: null, isPending: false, isError: false }),
	useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));

import { DASHBOARD_TOUR_KEY } from "@/lib/tours/dashboardTour";
import { useTour } from "./useTour";

function event(type: string, status: string, index: number) {
	return { type, status, index } as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	recordTourProgress.mockResolvedValue(null);
	fetchTourProgress.mockResolvedValue(null);
	hasSeenTourLocally.mockReturnValue(false);
	window.matchMedia = vi.fn().mockReturnValue({
		matches: false,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	}) as never;
});

afterEach(cleanup);

describe("useTour terminal events", () => {
	it("records a completed run on TOUR_END", async () => {
		const { result } = renderHook(() => useTour(DASHBOARD_TOUR_KEY));

		await act(async () => {
			result.current.handleEvent(event(EVENTS.TOUR_END, STATUS.FINISHED, 5));
		});

		expect(recordTourProgress).toHaveBeenCalledTimes(1);
		expect(recordTourProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-1",
				tourKey: DASHBOARD_TOUR_KEY,
				status: "completed",
				lastStep: 5,
			}),
		);
	});

	it("records a skip as skipped, keeping the step it was abandoned on", async () => {
		const { result } = renderHook(() => useTour(DASHBOARD_TOUR_KEY));

		await act(async () => {
			result.current.handleEvent(event(EVENTS.TOUR_END, STATUS.SKIPPED, 1));
		});

		expect(recordTourProgress).toHaveBeenCalledWith(
			expect.objectContaining({ status: "skipped", lastStep: 1 }),
		);
	});

	it("ignores TOUR_STATUS, which fires on stop/reset and is not a completion", async () => {
		const { result } = renderHook(() => useTour(DASHBOARD_TOUR_KEY));

		await act(async () => {
			result.current.handleEvent(event(EVENTS.TOUR_STATUS, STATUS.FINISHED, 5));
			result.current.handleEvent(event(EVENTS.STEP_AFTER, STATUS.RUNNING, 2));
		});

		expect(recordTourProgress).not.toHaveBeenCalled();
	});
});

describe("local seen cache", () => {
	it("marks the tour seen locally after a completed run", async () => {
		const { result } = renderHook(() => useTour(DASHBOARD_TOUR_KEY));

		await act(async () => {
			result.current.handleEvent(event(EVENTS.TOUR_END, STATUS.FINISHED, 5));
		});

		expect(markTourSeenLocally).toHaveBeenCalledWith(
			"user-1",
			DASHBOARD_TOUR_KEY,
			expect.objectContaining({ scopeType: "global" }),
		);
	});

	it("reports hasSeen from the local cache without hitting the server", () => {
		hasSeenTourLocally.mockReturnValue(true);

		const { result } = renderHook(() => useTour(DASHBOARD_TOUR_KEY));

		expect(result.current.hasSeen).toBe(true);
		expect(fetchTourProgress).not.toHaveBeenCalled();
	});

	it("counts a run as a replay when only the local cache knows about it", async () => {
		// The query is disabled in this state, so progressQuery.data is undefined;
		// without the local check this would overwrite the original row instead of
		// incrementing replay_count.
		hasSeenTourLocally.mockReturnValue(true);

		const { result } = renderHook(() => useTour(DASHBOARD_TOUR_KEY));

		await act(async () => {
			result.current.handleEvent(event(EVENTS.TOUR_END, STATUS.FINISHED, 5));
		});

		expect(recordTourReplay).toHaveBeenCalledTimes(1);
		expect(recordTourProgress).not.toHaveBeenCalled();
	});
});
