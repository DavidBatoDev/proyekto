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
import { timeService } from "@/services/time.service";
import type { LoggingForResult, LoggingOption } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { ForFilter, personalOnlyResult, usePersonalWhy } from "./ForFilter";
import type { ForFilterOption } from "./useTimePageData";

const OPTIONS: ForFilterOption[] = [
	{
		value: "assignment:a1",
		label: "Acme Corp · agreement",
		kind: "assignment",
	},
	{ value: "team:t1", label: "Prodigitality Services Inc. Team", kind: "team" },
	{ value: "personal", label: "Just me", kind: "personal" },
];

const PERSONAL: LoggingOption = {
	kind: "personal",
	id: null,
	label: "Just me",
	sheet_scope: null,
	rate_source: "none",
	workspace_tag: null,
	approver_hint: null,
};

function result(over: Partial<LoggingForResult> = {}): LoggingForResult {
	return {
		options: [PERSONAL],
		selected: PERSONAL,
		prefill: null,
		personal_reason: "plan",
		unavailable: [],
		...over,
	};
}

let client: QueryClient;

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	useAuthStore.setState({ user: { id: "u1" } as never });
});

afterEach(() => {
	cleanup();
	client.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
});

describe("ForFilter", () => {
	it("filters by context with All first", () => {
		const onChange = vi.fn();
		render(<ForFilter options={OPTIONS} onChange={onChange} />);
		const select = screen.getByLabelText("For:") as HTMLSelectElement;
		expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
			"All",
			"Acme Corp · agreement",
			"Prodigitality Services Inc. Team",
			"Just me",
		]);
		expect(select.value).toBe("__all__");
		fireEvent.change(select, { target: { value: "team:t1" } });
		expect(onChange).toHaveBeenLastCalledWith("team:t1");
		fireEvent.change(select, { target: { value: "__all__" } });
		expect(onChange).toHaveBeenLastCalledWith(undefined);
	});

	it("shows the current value", () => {
		render(<ForFilter value="personal" options={OPTIONS} onChange={vi.fn()} />);
		expect((screen.getByLabelText("For:") as HTMLSelectElement).value).toBe(
			"personal",
		);
	});

	it("reads For: Just me with Why? when that is the only option", () => {
		render(
			<QueryClientProvider client={client}>
				<ForFilter
					options={[]}
					onChange={vi.fn()}
					personal={{ personal_reason: "plan", unavailable: [] }}
				/>
			</QueryClientProvider>,
		);
		const node = screen.getByTestId("for-filter-personal");
		expect(node.textContent).toContain("For:");
		expect(node.textContent).toContain("Just me");
		fireEvent.click(screen.getByRole("button", { name: "Why?" }));
		expect(
			screen.getByText(
				"Your workspace's plan doesn't include timesheets; this time is just for you.",
			),
		).toBeTruthy();
	});

	it("renders nothing with nothing to filter", () => {
		const { container } = render(<ForFilter options={[]} onChange={vi.fn()} />);
		expect(container.innerHTML).toBe("");
	});
});

describe("usePersonalWhy", () => {
	it("is the resolver's answer when Just me is the only option", () => {
		expect(personalOnlyResult(result())).toEqual({
			personal_reason: "plan",
			unavailable: [],
		});
		expect(
			personalOnlyResult(
				result({
					options: [
						PERSONAL,
						{ ...PERSONAL, kind: "team", id: "t1", label: "Design" },
					],
				}),
			),
		).toBeNull();
		expect(personalOnlyResult(null)).toBeNull();
	});

	it("asks the most recently logged project's resolver, only when enabled", async () => {
		const projects = vi.spyOn(timeService, "listMyProjects").mockResolvedValue({
			projects: [
				{
					id: "p1",
					title: "Side",
					workspace_id: "w1",
					options: 1,
					default_kind: null,
				},
			],
		});
		const loggingFor = vi
			.spyOn(timeService, "getLoggingFor")
			.mockResolvedValue(result());
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
		const off = renderHook(() => usePersonalWhy(false), { wrapper });
		expect(off.result.current).toBeNull();
		expect(projects).not.toHaveBeenCalled();

		const on = renderHook(() => usePersonalWhy(true), { wrapper });
		await waitFor(() =>
			expect(on.result.current).toEqual({
				personal_reason: "plan",
				unavailable: [],
			}),
		);
		expect(loggingFor).toHaveBeenCalledWith("p1");
	});
});
