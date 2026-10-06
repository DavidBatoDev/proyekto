/* @vitest-environment jsdom */

// Native copy rules for the report kit (ux.md › Mobile; web blueprint §4):
// never the words contract, rate, payout or invoice; no amounts on agreement
// time; no /engagements links. Team time may show its cost on native.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	}),
}));
const plan = vi.hoisted(() => ({ hasExport: true }));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: (workspaceId?: string | null) => ({
		status: workspaceId ? "ready" : "unavailable",
		usage: workspaceId ? { workspace_id: workspaceId, features: [] } : null,
		plan: workspaceId ? "pro" : null,
		upgradePlan: "business",
		isComplimentary: false,
		hasFeature: () => plan.hasExport,
	}),
}));

import { timeService } from "@/services/time.service";
import type { TimeEntryView } from "@/services/time.types";
import {
	ENGAGEMENT_ID,
	entry,
	group,
	maskedAgreementEntry,
	NOW,
	PROJECT_ID,
	summary,
	TEAM_ID,
	U1,
	WORKSPACE_ID,
} from "./__fixtures__/reportFixtures";
import { ClientHoursView } from "./ClientHoursView";
import { ExportButton } from "./ExportButton";
import { ReportEntriesTable } from "./ReportEntriesTable";
import { ReportFilters } from "./ReportFilters";
import { ReportSections } from "./ReportSections";
import { sectionsFromEntries } from "./reportModel";
import { TimeReport } from "./TimeReport";
import { UnderAgreementsSection } from "./UnderAgreementsSection";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe(options: { amounts: boolean }) {
	const text = document.body.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	if (!options.amounts) expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(document.body.querySelectorAll("[title]"))) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
	}
	for (const el of Array.from(document.body.querySelectorAll("[aria-label]"))) {
		expect(el.getAttribute("aria-label") ?? "").not.toMatch(BANNED);
	}
	expect(document.body.querySelector('a[href*="/engagements"]')).toBeNull();
}

function renderWithClient(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

/** Agreement time the viewer may name and cost (a provider-side party). */
function namedAgreementEntry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return entry({
		id: "ag",
		context_kind: "assignment",
		context_ref: "as1",
		context_label_snapshot: "Acme Corp",
		payable_seconds: 7200,
		duration_seconds: 7200,
		cost: "visible",
		rate_snapshot: 25,
		currency_snapshot: "USD",
		amount_snapshot: 50,
		...over,
	});
}

const teamCostEntry = entry({
	id: "tm",
	payable_seconds: 3600,
	cost: "visible",
	rate_snapshot: 450,
	currency_snapshot: "PHP",
	amount_snapshot: 450,
});

beforeEach(() => {
	plan.hasExport = true;
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("report kit on native", () => {
	it("project Everyone: agreement sections carry no amount, and no export", async () => {
		vi.spyOn(timeService, "getReportSummary").mockResolvedValue(
			summary({ scope: { kind: "project", id: PROJECT_ID } }),
		);
		vi.spyOn(timeService, "getReportEntries").mockResolvedValue({
			items: [
				teamCostEntry,
				namedAgreementEntry(),
				maskedAgreementEntry({
					id: "mk",
					context_ref: "as2",
					payable_seconds: 600,
				}),
			],
			total: 3,
			page: 1,
			limit: 200,
		});
		renderWithClient(
			<TimeReport
				scope={{ kind: "project", id: PROJECT_ID }}
				layout="sections"
				search={{}}
				onSearchChange={vi.fn()}
				planWorkspace={{ id: WORKSPACE_ID }}
				now={NOW}
			/>,
		);
		const agreement = await screen.findByRole("region", {
			name: "Acme Corp · agreement",
		});
		await waitFor(() =>
			expect(document.body.textContent).toContain("PHP 450.00"),
		);
		expect(agreement.textContent).not.toMatch(AMOUNT);
		expect(agreement.textContent).toContain("(hours only)");
		expect(
			screen.getByRole("region", {
				name: "Delivery team · agreement with Acme Corp",
			}).textContent,
		).not.toMatch(AMOUNT);
		expect(document.body.textContent).not.toContain("USD");
		expect(screen.getByRole("group", { name: "Cost" }).textContent).toBe(
			"CostPHP 450.00",
		);
		expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
		assertNativeSafe({ amounts: true });
	});

	it("workspace report: no amounts at all, since rows may hold agreement time", async () => {
		vi.spyOn(timeService, "getReportSummary").mockResolvedValue(
			summary({
				scope: { kind: "workspace", id: WORKSPACE_ID },
				total_seconds: 7200,
				payable_seconds: 7200,
				groups: [
					group({
						key: U1,
						label: "Maria Santos",
						total_seconds: 7200,
						payable_seconds: 7200,
						amounts_by_currency: { USD: 50 },
					}),
				],
			}),
		);
		vi.spyOn(timeService, "getReportEntries").mockResolvedValue({
			items: [namedAgreementEntry()],
			total: 1,
			page: 1,
			limit: 50,
		});
		renderWithClient(
			<TimeReport
				scope={{ kind: "workspace", id: WORKSPACE_ID }}
				search={{ status: "approved" }}
				onSearchChange={vi.fn()}
				now={NOW}
			/>,
		);
		await waitFor(() =>
			expect(document.body.textContent).toContain("Maria Santos"),
		);
		await waitFor(() =>
			expect(document.body.textContent).toContain("Fix login bug"),
		);
		expect(screen.queryByRole("group", { name: "Cost" })).toBeNull();
		assertNativeSafe({ amounts: false });
	});

	it("workspace report without the plan: the notice is native-safe", () => {
		plan.hasExport = false;
		renderWithClient(
			<TimeReport
				scope={{ kind: "workspace", id: WORKSPACE_ID }}
				search={{}}
				onSearchChange={vi.fn()}
				now={NOW}
			/>,
		);
		expect(document.body.textContent).toContain("part of Business");
		assertNativeSafe({ amounts: false });
	});

	it("entries: agreement rows read the counterparty only, with no amount", () => {
		render(
			<ReportEntriesTable
				entries={[namedAgreementEntry()]}
				total={1}
				page={1}
				timezone="Asia/Manila"
			/>,
		);
		expect(document.body.textContent).toContain("Acme Corp");
		expect(document.body.textContent).not.toContain("agreement");
		assertNativeSafe({ amounts: false });
	});

	it("sections, under agreements and client hours stay native-safe", async () => {
		render(
			<>
				<ReportSections
					sections={sectionsFromEntries([
						namedAgreementEntry(),
						maskedAgreementEntry({
							id: "mk",
							context_ref: "as2",
							payable_seconds: 600,
						}),
					])}
				/>
				<UnderAgreementsSection seconds={3600} />
			</>,
		);
		assertNativeSafe({ amounts: false });
		cleanup();

		vi.spyOn(timeService, "getReportSummary").mockResolvedValue(
			summary({
				scope: { kind: "engagement", id: ENGAGEMENT_ID },
				total_seconds: 3600,
				payable_seconds: 3600,
				groups: [
					group({
						key: "2026-09-21",
						label: "Sep 21–27",
						total_seconds: 3600,
						payable_seconds: 3600,
					}),
				],
			}),
		);
		renderWithClient(
			<ClientHoursView
				range={{ from: "2026-09-01", to: "2026-09-30" }}
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
			expect(document.body.textContent).toContain("Sep 21–27"),
		);
		assertNativeSafe({ amounts: false });
	});

	it("filters: no pay cut-offs, and Export renders nothing", () => {
		const { container } = renderWithClient(
			<>
				<ReportFilters
					range={{ from: "2026-09-01", to: "2026-09-30" }}
					onRangeChange={vi.fn()}
					timezone="Asia/Manila"
					cutoffs={{ config: null }}
					forKinds={["team", "workspace", "assignment"]}
					onForChange={vi.fn()}
					showStatus
					onStatusChange={vi.fn()}
				/>
				<ExportButton
					query={{
						scope: { kind: "team", id: TEAM_ID },
						from: "2026-09-01",
						to: "2026-09-30",
					}}
				/>
			</>,
		);
		const trigger = container.querySelector(
			"button[aria-expanded]:not([aria-haspopup])",
		) as HTMLButtonElement;
		fireEvent.click(trigger);
		expect(
			screen.queryByRole("button", { name: "Current cut-off" }),
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "For: all" }));
		expect(screen.getByRole("option", { name: "For: agreement" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
		assertNativeSafe({ amounts: false });
	});
});
