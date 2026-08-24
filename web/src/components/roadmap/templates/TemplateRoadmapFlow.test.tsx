/* @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoadmapTemplateVersionContent } from "@/types/roadmap-template";
import { TemplateRoadmapFlow } from "./TemplateRoadmapFlow";

vi.mock("../views/roadmap/RoadmapView", () => ({
	RoadmapView: () => <div data-testid="roadmap-view-stub" />,
	PANEL_FOCUS_TRANSITION: { zoom: 0.5, durationMs: 600 },
}));

vi.mock("../panels/RoadmapLeftSidePanel", () => ({
	RoadmapLeftSidePanel: () => <div data-testid="left-panel-stub" />,
}));

const CONTENT: RoadmapTemplateVersionContent = {
	roadmap: {
		name: "Learn SQL Fundamentals",
		description: "A template",
		start_day_offset: 0,
		end_day_offset: 30,
	},
	epics: [],
} as unknown as RoadmapTemplateVersionContent;

// The component pins beneath an 80px header and expands over 480px of scroll;
// these mirror HEADER_OFFSET_PX / EXPAND_SCROLL_DISTANCE in the component.
const PINNED_TOP = 80;
const FULLY_EXPANDED_TOP = PINNED_TOP - 480;

describe("TemplateRoadmapFlow fullscreen takeover", () => {
	let rafQueue: FrameRequestCallback[];
	let outerTop: number;

	const flushFrames = (count = 60) => {
		for (let i = 0; i < count; i++) {
			const queue = rafQueue;
			rafQueue = [];
			if (queue.length === 0) break;
			act(() => {
				for (const cb of queue) cb(performance.now());
			});
		}
	};

	const setScrollTop = (top: number) => {
		outerTop = top;
		act(() => {
			window.dispatchEvent(new Event("scroll"));
		});
		flushFrames();
	};

	const renderFlow = () => {
		render(
			<TemplateRoadmapFlow
				templateId="tpl-1"
				content={CONTENT}
				startDate="2026-08-24"
			/>,
		);
		const section = screen.getByTestId("template-roadmap-flow");
		const outer = section.parentElement as HTMLElement;
		outer.getBoundingClientRect = () =>
			({ top: outerTop, left: 0, width: 1200, height: 1400 }) as DOMRect;
		flushFrames();
		return { section, outer };
	};

	beforeEach(() => {
		rafQueue = [];
		outerTop = 600;
		vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
			rafQueue.push(cb);
			return rafQueue.length;
		});
		vi.stubGlobal("cancelAnimationFrame", () => undefined);
		vi.stubGlobal(
			"matchMedia",
			(query: string) => ({ matches: false, media: query }) as MediaQueryList,
		);
		window.scrollTo = vi.fn();
		window.scrollBy = vi.fn();
	});

	afterEach(() => {
		cleanup();
		document.documentElement.style.overflow = "";
		vi.unstubAllGlobals();
	});

	it("scrubs progress from the scroll position", () => {
		const { outer } = renderFlow();
		expect(outer.style.getPropertyValue("--rf-p")).toBe("0.0000");

		setScrollTop(PINNED_TOP - 240); // halfway through the expansion
		const p = Number(outer.style.getPropertyValue("--rf-p"));
		expect(p).toBeGreaterThan(0.4);
		expect(p).toBeLessThan(0.6);
		expect(document.documentElement.style.overflow).toBe("");
		// The canvas is inert until fullscreen — wheel/drag must keep driving
		// the page scroll, not canvas zoom/pan.
		expect(screen.getByTestId("template-roadmap-canvas").className).toContain(
			"pointer-events-none",
		);
	});

	it("latches into fullscreen at full expansion and locks page scroll", () => {
		const { outer, section } = renderFlow();
		setScrollTop(FULLY_EXPANDED_TOP - 47); // overshoot into the tail padding

		expect(outer.style.getPropertyValue("--rf-p")).toBe("1.0000");
		expect(document.documentElement.style.overflow).toBe("hidden");
		// Overshoot is snapped back so the locked card sits exactly fullscreen.
		expect(window.scrollBy).toHaveBeenCalledWith(0, -47);
		// Once the expansion lerp completes the card hard-pins with fixed
		// positioning so the back bar can never hide under the site header.
		expect(section.style.position).toBe("fixed");
		expect(
			screen.getByRole("button", { name: /back to template/i }),
		).toBeTruthy();
		expect(
			screen.getByTestId("template-roadmap-canvas").className,
		).not.toContain("pointer-events-none");
		expect(screen.getByTestId("left-panel-stub")).toBeTruthy();
	});

	it("exits via a single click of the header button without re-latching", () => {
		const { section } = renderFlow();
		setScrollTop(FULLY_EXPANDED_TOP);
		expect(document.documentElement.style.overflow).toBe("hidden");
		expect(section.style.position).toBe("fixed");

		fireEvent.click(screen.getByRole("button", { name: /back to template/i }));
		expect(document.documentElement.style.overflow).toBe("");
		expect(section.style.position).toBe("sticky");
		// The exit ride goes all the way back to the top of the template page.
		expect(window.scrollTo).toHaveBeenCalledWith({
			top: 0,
			behavior: "smooth",
		});

		// The exit scroll hasn't moved yet — frames at the same position must
		// not re-enter fullscreen.
		setScrollTop(FULLY_EXPANDED_TOP);
		expect(document.documentElement.style.overflow).toBe("");

		// Once the scroll leaves the latch zone the guard clears, so scrolling
		// back down re-enters fullscreen.
		setScrollTop(PINNED_TOP - 240);
		setScrollTop(FULLY_EXPANDED_TOP);
		expect(document.documentElement.style.overflow).toBe("hidden");
	});

	it("re-latches when an interrupted exit scrolls deeper again", () => {
		const { section } = renderFlow();
		setScrollTop(FULLY_EXPANDED_TOP);
		fireEvent.click(screen.getByRole("button", { name: /back to template/i }));
		expect(document.documentElement.style.overflow).toBe("");

		// The user cancels the exit scroll by scrolling down again while still
		// inside the latch zone. This must re-enter fullscreen — previously the
		// exit guard never cleared here, stranding the card in sticky mode
		// (pushed under the site header with a gap at the bottom).
		setScrollTop(FULLY_EXPANDED_TOP - 47);
		expect(document.documentElement.style.overflow).toBe("hidden");
		expect(section.style.position).toBe("fixed");
	});

	it("exits fullscreen on Escape", () => {
		renderFlow();
		setScrollTop(FULLY_EXPANDED_TOP);
		expect(document.documentElement.style.overflow).toBe("hidden");

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});
		expect(document.documentElement.style.overflow).toBe("");
	});
});
