/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { TimeApiError, timeService } from "@/services/time.service";
import {
	ENGAGEMENT_ID,
	entry,
	group,
	NOW,
	summary,
} from "./__fixtures__/reportFixtures";
import { ClientHoursView } from "./ClientHoursView";

const range = { from: "2026-09-01", to: "2026-09-30" };

function renderWithClient(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

const weekly = summary({
	scope: { kind: "engagement", id: ENGAGEMENT_ID },
	total_seconds: 7200,
	payable_seconds: 7200,
	groups: [
		group({
			key: "2026-09-21",
			label: "Sep 21–27",
			total_seconds: 7200,
			payable_seconds: 7200,
		}),
	],
});

const notFound = () =>
	new TimeApiError({
		status: 404,
		code: "TIME_NOT_FOUND",
		message: "Not found",
	});

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("ClientHoursView", () => {
	it("shows approved hours by week at the summary level, with no person or cost", async () => {
		const getSummary = vi
			.spyOn(timeService, "getReportSummary")
			.mockResolvedValue(weekly);
		const getEntries = vi.spyOn(timeService, "getReportEntries");
		renderWithClient(
			<ClientHoursView
				range={range}
				agreements={[
					{
						engagementId: ENGAGEMENT_ID,
						label: "Pixel Studio",
						level: "summary",
					},
				]}
			/>,
		);
		const block = await screen.findByRole("region", {
			name: "Pixel Studio · agreement",
		});
		await waitFor(() => expect(block.textContent).toContain("Sep 21–27"));
		expect(block.textContent).toContain("Approved 2:00");
		expect(block.textContent).not.toContain("Not yet approved");
		expect(getSummary).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: { kind: "engagement", id: ENGAGEMENT_ID },
				group_by: "week",
				from: "2026-09-01",
				to: "2026-09-30",
			}),
		);
		expect(getEntries).not.toHaveBeenCalled();
	});

	it("lists date, work and approved hours at the detailed level, never the person or cost", async () => {
		vi.spyOn(timeService, "getReportSummary").mockResolvedValue(weekly);
		vi.spyOn(timeService, "getReportEntries").mockResolvedValue({
			items: [
				entry({
					payable_seconds: 5400,
					cost: "visible",
					currency_snapshot: "USD",
					amount_snapshot: 90,
					note: "Private note",
				}),
			],
			total: 1,
			page: 1,
			limit: 50,
		});
		renderWithClient(
			<ClientHoursView
				range={range}
				agreements={[
					{
						engagementId: ENGAGEMENT_ID,
						label: "Pixel Studio",
						level: "detailed",
					},
				]}
			/>,
		);
		await waitFor(() =>
			expect(document.body.textContent).toContain(
				"Acme Website · Fix login bug",
			),
		);
		expect(document.body.textContent).toContain("1:30");
		expect(document.body.textContent).not.toMatch(/Maria|USD|Private note/);
	});

	it("falls back to weeks when the detailed read is refused", async () => {
		vi.spyOn(timeService, "getReportSummary").mockResolvedValue(weekly);
		vi.spyOn(timeService, "getReportEntries").mockRejectedValue(notFound());
		renderWithClient(
			<ClientHoursView
				range={range}
				agreements={[
					{
						engagementId: ENGAGEMENT_ID,
						label: "Pixel Studio",
						level: "detailed",
					},
				]}
			/>,
		);
		await waitFor(() =>
			expect(document.body.textContent).toContain("Sep 21–27"),
		);
	});

	it("shows a reason card for an agreement the client can't open", async () => {
		vi.spyOn(timeService, "getReportSummary").mockRejectedValue(notFound());
		renderWithClient(
			<ClientHoursView
				range={range}
				agreements={[
					{
						engagementId: ENGAGEMENT_ID,
						label: "Pixel Studio",
						level: "summary",
					},
				]}
			/>,
		);
		await waitFor(() =>
			expect(document.body.textContent).toContain(
				"This doesn't exist or you can't open it.",
			),
		);
	});
});
