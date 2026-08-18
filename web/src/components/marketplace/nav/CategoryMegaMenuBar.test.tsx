/* @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceCategoryNav } from "@/types/marketplace-taxonomy";
import { CategoryMegaMenuBar } from "./CategoryMegaMenuBar";
import { MEGA_CLOSE_DELAY_MS } from "./categoryMegaMenu";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		...rest
	}: {
		children?: ReactNode;
		to: string;
		params?: Record<string, string>;
		[key: string]: unknown;
	}) => {
		let href = to;
		for (const [key, value] of Object.entries(params ?? {})) {
			href = href.replace(`$${key}`, value);
		}
		// `preload` is a router prop, not a DOM attribute - dropping it here keeps
		// React from warning about an unknown attribute on every render.
		const { preload: _preload, ref, ...domProps } = rest;
		return (
			<a href={href} ref={ref as React.Ref<HTMLAnchorElement>} {...domProps}>
				{children}
			</a>
		);
	},
}));

vi.mock("framer-motion", () => ({
	AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
	motion: {
		div: ({ children, ...rest }: { children?: ReactNode }) => (
			<div {...rest}>{children}</div>
		),
	},
	useReducedMotion: () => true,
}));

const CATEGORIES: MarketplaceCategoryNav[] = [
	{
		id: "cat-1",
		slug: "ai-and-data",
		name: "AI & Data",
		description: "Applied AI",
		icon: "Sparkles",
		position: 1,
		subcategories: [
			{
				id: "sub-1",
				slug: "llm-application-development",
				name: "LLM Application Development",
				description: null,
				position: 1,
			},
		],
	},
	{
		id: "cat-2",
		slug: "design-and-brand",
		name: "Design & Brand",
		description: null,
		icon: "Palette",
		position: 2,
		subcategories: [
			{
				id: "sub-2",
				slug: "ux-research",
				name: "UX Research",
				description: null,
				position: 1,
			},
		],
	},
];

/** The component renders no panel unless the pointer is a fine, hover-capable one. */
function stubHoverCapable(matches: boolean) {
	window.matchMedia = vi.fn().mockReturnValue({
		matches,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	}) as unknown as typeof window.matchMedia;
}

const trigger = (name: string) =>
	screen.getByRole("link", { name: new RegExp(`^${name}$`) });

beforeEach(() => {
	vi.useFakeTimers();
	stubHoverCapable(true);
});

afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

describe("CategoryMegaMenuBar", () => {
	it("opens the panel on hover and marks the trigger expanded", () => {
		render(<CategoryMegaMenuBar categories={CATEGORIES} />);
		expect(screen.queryByRole("menu")).toBeNull();

		fireEvent.mouseEnter(trigger("AI & Data"));

		expect(screen.getByRole("menu")).toBeTruthy();
		expect(trigger("AI & Data").getAttribute("aria-expanded")).toBe("true");
		expect(
			screen.getByRole("menuitem", { name: "LLM Application Development" }),
		).toBeTruthy();
	});

	// The whole reason for the grace timer: the pointer needs time to travel from
	// the trigger into the panel without the panel vanishing underneath it.
	it("keeps the panel open until the close delay elapses", () => {
		render(<CategoryMegaMenuBar categories={CATEGORIES} />);
		fireEvent.mouseEnter(trigger("AI & Data"));
		fireEvent.mouseLeave(trigger("AI & Data"));

		// act() is required around the timer: with fake timers React's scheduler
		// is faked too, so a state update from a timeout is not flushed otherwise.
		act(() => vi.advanceTimersByTime(MEGA_CLOSE_DELAY_MS - 1));
		expect(screen.queryByRole("menu")).toBeTruthy();

		act(() => vi.advanceTimersByTime(2));
		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("cancels the close when the pointer reaches the panel", () => {
		render(<CategoryMegaMenuBar categories={CATEGORIES} />);
		fireEvent.mouseEnter(trigger("AI & Data"));
		fireEvent.mouseLeave(trigger("AI & Data"));
		fireEvent.mouseEnter(screen.getByRole("menu"));

		act(() => vi.advanceTimersByTime(MEGA_CLOSE_DELAY_MS * 2));
		expect(screen.queryByRole("menu")).toBeTruthy();
	});

	it("swaps panels when sliding to the next category", () => {
		render(<CategoryMegaMenuBar categories={CATEGORIES} />);
		fireEvent.mouseEnter(trigger("AI & Data"));
		fireEvent.mouseEnter(trigger("Design & Brand"));

		expect(screen.getByRole("menuitem", { name: "UX Research" })).toBeTruthy();
		expect(
			screen.queryByRole("menuitem", { name: "LLM Application Development" }),
		).toBeNull();
		expect(trigger("AI & Data").getAttribute("aria-expanded")).toBe("false");
	});

	it("closes on Escape", () => {
		render(<CategoryMegaMenuBar categories={CATEGORIES} />);
		fireEvent.mouseEnter(trigger("AI & Data"));

		// The panel listens on document directly, outside React's event system, so
		// this update needs an explicit flush.
		act(() => {
			fireEvent.keyDown(document, { key: "Escape" });
		});

		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("portals the panel out of the horizontally scrolling strip", () => {
		render(<CategoryMegaMenuBar categories={CATEGORIES} />);
		fireEvent.mouseEnter(trigger("AI & Data"));

		// The strip is `overflow-x-auto`; an in-flow panel would be clipped by it.
		expect(screen.getByRole("menu").closest("nav")).toBeNull();
	});

	it("moves focus between triggers with arrow keys", () => {
		render(<CategoryMegaMenuBar categories={CATEGORIES} />);
		const first = trigger("AI & Data");
		first.focus();

		fireEvent.keyDown(first, { key: "ArrowRight" });
		expect(document.activeElement).toBe(trigger("Design & Brand"));

		fireEvent.keyDown(trigger("Design & Brand"), { key: "ArrowRight" });
		expect(document.activeElement).toBe(trigger("AI & Data"));
	});

	it("renders no panel on a coarse pointer, leaving the trigger a plain link", () => {
		stubHoverCapable(false);
		render(<CategoryMegaMenuBar categories={CATEGORIES} />);

		fireEvent.mouseEnter(trigger("AI & Data"));

		expect(screen.queryByRole("menu")).toBeNull();
		expect(trigger("AI & Data").getAttribute("href")).toBe(
			"/marketplace/category/ai-and-data",
		);
	});

	it("renders nothing without categories", () => {
		const { container } = render(<CategoryMegaMenuBar categories={[]} />);
		expect(container.firstChild).toBeNull();
	});
});
