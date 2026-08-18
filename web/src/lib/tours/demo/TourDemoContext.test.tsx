/* @vitest-environment jsdom */

/**
 * Demo mode is what makes tour replay work on an empty account, so the two
 * things worth pinning are: it is inert until something enters it (otherwise
 * fixtures could bleed into a real dashboard), and it does swap when active.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
	TourDemoProvider,
	useTourDemo,
	useTourDemoActive,
	useTourDemoControls,
} from "./TourDemoContext";

afterEach(cleanup);

const wrapper = ({ children }: { children: ReactNode }) => (
	<TourDemoProvider>{children}</TourDemoProvider>
);

describe("useTourDemo", () => {
	it("returns real data when no tour is replaying", () => {
		const real = [{ id: "real-1" }];
		const { result } = renderHook(() => useTourDemo("projects", real), {
			wrapper,
		});
		expect(result.current).toBe(real);
	});

	it("returns real data outside the provider entirely", () => {
		const real = [{ id: "real-1" }];
		const { result } = renderHook(() => useTourDemo("projects", real));
		expect(result.current).toBe(real);
		expect(result.current).toEqual(real);
	});

	it("swaps in fixtures while demo mode is active, and restores on exit", () => {
		const real = [{ id: "real-1" }];
		const fixtures = [{ id: "tour-demo-project-1" }];

		const { result } = renderHook(
			() => ({
				data: useTourDemo("projects", real),
				active: useTourDemoActive(),
				controls: useTourDemoControls(),
			}),
			{ wrapper },
		);

		act(() => result.current.controls.enter({ projects: fixtures }));
		expect(result.current.active).toBe(true);
		expect(result.current.data).toBe(fixtures);

		act(() => result.current.controls.exit());
		expect(result.current.active).toBe(false);
		expect(result.current.data).toBe(real);
	});

	it("leaves keys the dataset does not define alone", () => {
		const real = [{ id: "real-roadmap" }];
		const { result } = renderHook(
			() => ({
				data: useTourDemo("roadmaps", real),
				controls: useTourDemoControls(),
			}),
			{ wrapper },
		);

		// A dataset that only covers projects must not blank out roadmaps.
		act(() => result.current.controls.enter({ projects: [] }));
		expect(result.current.data).toBe(real);
	});
});
