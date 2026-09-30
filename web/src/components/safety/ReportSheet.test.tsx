/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	mutateAsync: vi.fn(),
	reset: vi.fn(),
	isPending: false,
}));

vi.mock("@/queries/safety", () => ({
	useReportContent: () => ({
		mutateAsync: mocks.mutateAsync,
		reset: mocks.reset,
		isPending: mocks.isPending,
	}),
}));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@/hooks/useIsMobile", () => ({ useIsMobile: () => false }));

import { ReportSheet, type ReportTarget } from "./ReportSheet";

const target: ReportTarget = {
	type: "chat_message",
	id: "11111111-1111-4111-8111-111111111111",
	author: { id: "author-1", name: "Andy Author" },
	preview: "buy cheap followers",
	previewMeta: "2:14 PM",
};

describe("ReportSheet", () => {
	beforeEach(() => {
		mocks.mutateAsync
			.mockReset()
			.mockResolvedValue({ id: "r1", blocked: false });
	});
	afterEach(cleanup);

	it("shows what is being reported and needs a reason before it will submit", () => {
		render(
			<ReportSheet target={target} isAuthorBlocked={false} onClose={vi.fn()} />,
		);

		expect(screen.getByText("Report message")).toBeTruthy();
		expect(screen.getByText("buy cheap followers")).toBeTruthy();
		expect(screen.getByText("Andy won't know you reported this.")).toBeTruthy();
		const submit = screen.getByRole("button", { name: /submit report/i });
		expect((submit as HTMLButtonElement).disabled).toBe(true);

		fireEvent.click(screen.getByRole("radio", { name: /spam/i }));
		expect((submit as HTMLButtonElement).disabled).toBe(false);
	});

	it("sends the reason, trimmed note and block choice, then thanks the reporter", async () => {
		mocks.mutateAsync.mockResolvedValue({ id: "r1", blocked: true });
		render(
			<ReportSheet target={target} isAuthorBlocked={false} onClose={vi.fn()} />,
		);

		fireEvent.click(screen.getByRole("radio", { name: /harassment/i }));
		fireEvent.change(screen.getByPlaceholderText(/add context/i), {
			target: { value: "  third time today  " },
		});
		fireEvent.click(screen.getByRole("switch", { name: /also block andy/i }));
		fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

		await waitFor(() =>
			expect(screen.getByText("Thanks for letting us know")).toBeTruthy(),
		);
		expect(mocks.mutateAsync).toHaveBeenCalledWith({
			target_type: "chat_message",
			target_id: target.id,
			reason: "harassment",
			details: "third time today",
			also_block: true,
		});
		expect(screen.getByText("You also blocked Andy")).toBeTruthy();
	});

	it("does not offer to block someone already blocked", () => {
		render(<ReportSheet target={target} isAuthorBlocked onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole("radio", { name: /spam/i }));
		expect(screen.queryByRole("switch")).toBeNull();
	});

	it("keeps the form and shows the error when the report fails", async () => {
		mocks.mutateAsync.mockRejectedValue({
			response: { data: { message: "Message not found." } },
		});
		render(
			<ReportSheet target={target} isAuthorBlocked={false} onClose={vi.fn()} />,
		);

		fireEvent.click(screen.getByRole("radio", { name: /spam/i }));
		fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toBe("Message not found."),
		);
		expect(screen.queryByText("Thanks for letting us know")).toBeNull();
	});
});
