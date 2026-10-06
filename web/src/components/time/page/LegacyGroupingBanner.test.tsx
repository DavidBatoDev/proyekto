/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { timeService } from "@/services/time.service";
import type { TimesheetSummary } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	hasLegacySheets,
	LEGACY_BANNER_COPY,
	LEGACY_BANNER_STORAGE_KEY,
	LegacyGroupingBanner,
} from "./LegacyGroupingBanner";

const MESSAGE =
	"Your time is now grouped into timesheets. Past weeks were sent for approval for you.";

function withClient(children: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const legacy = [{ origin: "app" }, { origin: "legacy_migration" }] as const;

beforeEach(() => {
	window.localStorage.clear();
	useAuthStore.setState({ user: { id: "u1" } as never });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	useAuthStore.setState({ user: null });
});

describe("hasLegacySheets", () => {
	it("looks for a sheet from the per-entry review migration", () => {
		expect(hasLegacySheets(legacy)).toBe(true);
		expect(hasLegacySheets([{ origin: "app" }])).toBe(false);
		expect(hasLegacySheets(null)).toBe(false);
	});
});

describe("LegacyGroupingBanner", () => {
	it("shows the ux.md line and remembers Got it", () => {
		const { container } = render(
			withClient(<LegacyGroupingBanner sheets={legacy} />),
		);
		expect(screen.getByText(MESSAGE)).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: LEGACY_BANNER_COPY.dismiss }),
		);
		expect(container.innerHTML).toBe("");
		expect(window.localStorage.getItem(LEGACY_BANNER_STORAGE_KEY)).toBe("1");
	});

	it("stays away once dismissed, without reading timesheets", () => {
		window.localStorage.setItem("time-legacy-banner-dismissed", "1");
		const list = vi.spyOn(timeService, "listMyTimesheets");
		const { container } = render(withClient(<LegacyGroupingBanner />));
		expect(container.innerHTML).toBe("");
		expect(list).not.toHaveBeenCalled();
	});

	it("reads me/timesheets itself when the page passes none", async () => {
		const list = vi
			.spyOn(timeService, "listMyTimesheets")
			.mockResolvedValue(legacy as unknown as TimesheetSummary[]);
		render(withClient(<LegacyGroupingBanner />));
		expect(await screen.findByText(MESSAGE)).toBeTruthy();
		expect(list).toHaveBeenCalledWith({});
	});

	it("is hidden for people with no legacy sheets", async () => {
		const list = vi
			.spyOn(timeService, "listMyTimesheets")
			.mockResolvedValue([{ origin: "app" }] as unknown as TimesheetSummary[]);
		const { container } = render(withClient(<LegacyGroupingBanner />));
		await waitFor(() => expect(list).toHaveBeenCalled());
		expect(container.innerHTML).toBe("");
	});

	it("without storage it hides for now and shows again next time", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		const first = render(withClient(<LegacyGroupingBanner sheets={legacy} />));
		fireEvent.click(screen.getByRole("button", { name: "Got it" }));
		expect(first.container.innerHTML).toBe("");
		first.unmount();
		render(withClient(<LegacyGroupingBanner sheets={legacy} />));
		expect(screen.getByText(MESSAGE)).toBeTruthy();
	});
});
