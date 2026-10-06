/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeService } from "@/services/time.service";
import { useAuthStore } from "@/stores/authStore";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			className,
		}: {
			children?: ReactNode;
			className?: string;
		}) => (
			<a href="#x" className={className}>
				{children}
			</a>
		),
	};
});
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	}),
}));

import { WAITING_SECTION_ID, WaitingSection } from "./WaitingSection";

let client: QueryClient;

function renderSection(ui: ReactNode) {
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

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

describe("WaitingSection", () => {
	it("is hidden in normal mode while nothing waits, and asks for nothing", () => {
		const list = vi.spyOn(timeService, "listApprovals");
		const { container } = renderSection(<WaitingSection count={0} />);
		expect(container.innerHTML).toBe("");
		expect(list).not.toHaveBeenCalled();
	});

	it("carries the #waiting anchor and the list in normal mode", async () => {
		const list = vi.spyOn(timeService, "listApprovals").mockResolvedValue({
			items: [],
			total: 0,
			page: 1,
			limit: 50,
		});
		const { container } = renderSection(<WaitingSection count={2} />);
		const anchor = container.querySelector(
			`#${WAITING_SECTION_ID}`,
		) as HTMLElement;
		expect(anchor).toBeTruthy();
		expect(anchor.getAttribute("tabindex")).toBe("-1");
		// The overview said 2 but the list is empty now: no empty card, no list.
		await waitFor(() => expect(list).toHaveBeenCalled());
		await waitFor(() =>
			expect(screen.queryByTestId("waiting-for-you")).toBeNull(),
		);
		expect(screen.queryByText(/caught up/)).toBeNull();
	});

	it("always shows in approver mode, with the caught-up line", async () => {
		vi.spyOn(timeService, "listApprovals").mockResolvedValue({
			items: [],
			total: 0,
			page: 1,
			limit: 50,
		});
		renderSection(
			<WaitingSection
				approverMode
				count={0}
				emptyText="You're all caught up."
			/>,
		);
		expect(await screen.findByText("You're all caught up.")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Waiting for you" }),
		).toBeTruthy();
	});
});
