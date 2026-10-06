/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@/lib/timeFormat", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/timeFormat")>();
	return { ...actual, deviceTimeZone: () => "America/New_York" };
});

import { timeService } from "@/services/time.service";
import type { UserTimePreferences } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	prefsSummaryLine,
	resolveTimePreferences,
	TimePrefsMenu,
	useTimePreferences,
} from "./TimePrefsMenu";

function prefs(over: Partial<UserTimePreferences> = {}): UserTimePreferences {
	return {
		user_id: "u1",
		timezone: "Asia/Manila",
		week_start: 1,
		updated_at: "2026-10-01T00:00:00Z",
		...over,
	};
}

function makeClient() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function withClient(children: ReactNode, client = makeClient()) {
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: "u1" } as never });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	useAuthStore.setState({ user: null });
});

describe("preferences with fallbacks", () => {
	it("falls back to the device timezone and Monday (ux.md › Day strip)", () => {
		expect(resolveTimePreferences(null, "Europe/Paris")).toEqual({
			timezone: "Europe/Paris",
			weekStart: 1,
			stored: false,
		});
		expect(
			resolveTimePreferences(
				prefs({ timezone: "Bad/Zone", week_start: null }),
				"UTC",
			),
		).toEqual({ timezone: "UTC", weekStart: 1, stored: true });
		expect(resolveTimePreferences(prefs({ week_start: 7 }), "UTC")).toEqual({
			timezone: "Asia/Manila",
			weekStart: 7,
			stored: true,
		});
	});

	it("summary line", () => {
		expect(prefsSummaryLine({ timezone: "Asia/Manila", weekStart: 1 })).toBe(
			"Your time: Asia/Manila · weeks start Monday",
		);
		expect(prefsSummaryLine({ timezone: "UTC", weekStart: 7 })).toBe(
			"Your time: UTC · weeks start Sunday",
		);
	});

	it("useTimePreferences reads me/preferences", async () => {
		vi.spyOn(timeService, "getPreferences").mockResolvedValue(
			prefs({ week_start: 3 }),
		);
		const client = makeClient();
		const { result } = renderHook(() => useTimePreferences(), {
			wrapper: ({ children }) => withClient(children, client),
		});
		expect(result.current.timezone).toBe("America/New_York");
		await waitFor(() => expect(result.current.timezone).toBe("Asia/Manila"));
		expect(result.current.weekStart).toBe(3);
		expect(result.current.stored).toBe(true);
	});
});

describe("TimePrefsMenu", () => {
	it("edits the timezone and week start and saves them", async () => {
		let stored = prefs();
		vi.spyOn(timeService, "getPreferences").mockImplementation(
			async () => stored,
		);
		const set = vi
			.spyOn(timeService, "setPreferences")
			.mockImplementation(async (input) => {
				stored = prefs({
					timezone: input.timezone,
					week_start: input.week_start ?? null,
				});
				return stored;
			});
		const client = makeClient();
		const invalidate = vi.spyOn(client, "invalidateQueries");
		render(withClient(<TimePrefsMenu />, client));

		const trigger = screen.getByRole("button", { name: "Your time settings" });
		await waitFor(() =>
			expect(trigger.getAttribute("title")).toBe(
				"Your time: Asia/Manila · weeks start Monday",
			),
		);
		fireEvent.click(trigger);
		const dialog = await screen.findByRole("dialog", {
			name: "Your time settings",
		});
		expect(dialog.textContent).toContain(
			"Your time: Asia/Manila · weeks start Monday",
		);
		expect(dialog.textContent).toContain(
			"Timesheets count days in their own timezone.",
		);
		const save = screen.getByRole("button", { name: "Save" });
		expect((save as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(screen.getByLabelText("Timezone"), {
			target: { value: "UTC" },
		});
		fireEvent.change(screen.getByLabelText("Weeks start on"), {
			target: { value: "7" },
		});
		expect((save as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(save);

		await waitFor(() =>
			expect(set).toHaveBeenCalledWith({ timezone: "UTC", week_start: 7 }),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ["time", "me", "preferences"],
		});
		expect(trigger.getAttribute("title")).toBe(
			"Your time: UTC · weeks start Sunday",
		);
	});

	it("takes keyboard focus into the menu and gives it back to ⚙", async () => {
		vi.spyOn(timeService, "getPreferences").mockResolvedValue(prefs());
		render(withClient(<TimePrefsMenu />));
		const trigger = screen.getByRole("button", { name: "Your time settings" });
		fireEvent.click(trigger);
		await screen.findByRole("dialog", { name: "Your time settings" });
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByLabelText("Timezone")),
		);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(document.activeElement).toBe(trigger);
	});

	it("offers this device's timezone when it differs", async () => {
		vi.spyOn(timeService, "getPreferences").mockResolvedValue(prefs());
		render(withClient(<TimePrefsMenu />));
		const trigger = screen.getByRole("button", { name: "Your time settings" });
		await waitFor(() =>
			expect(trigger.getAttribute("title")).toContain("Asia/Manila"),
		);
		fireEvent.click(trigger);
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Use this device's timezone (America/New_York)",
			}),
		);
		expect((screen.getByLabelText("Timezone") as HTMLSelectElement).value).toBe(
			"America/New_York",
		);
	});

	it("with no row yet, Save keeps the fallbacks", async () => {
		vi.spyOn(timeService, "getPreferences").mockResolvedValue(null);
		const set = vi
			.spyOn(timeService, "setPreferences")
			.mockResolvedValue(prefs({ timezone: "America/New_York" }));
		render(withClient(<TimePrefsMenu />));
		fireEvent.click(screen.getByRole("button", { name: "Your time settings" }));
		await screen.findByRole("dialog");
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
					.disabled,
			).toBe(false),
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(set).toHaveBeenCalledWith({
				timezone: "America/New_York",
				week_start: 1,
			}),
		);
	});

	it("a failed save keeps the menu open with a reason", async () => {
		vi.spyOn(timeService, "getPreferences").mockResolvedValue(prefs());
		vi.spyOn(timeService, "setPreferences").mockRejectedValue(
			new Error("offline"),
		);
		render(withClient(<TimePrefsMenu />));
		const trigger = screen.getByRole("button", { name: "Your time settings" });
		await waitFor(() =>
			expect(trigger.getAttribute("title")).toContain("Asia/Manila"),
		);
		fireEvent.click(trigger);
		fireEvent.change(await screen.findByLabelText("Weeks start on"), {
			target: { value: "2" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByRole("dialog")).toBeTruthy();
	});
});
