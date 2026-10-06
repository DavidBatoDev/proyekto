/* @vitest-environment jsdom */

// Native rules (ux.md › Mobile; web blueprint §4). The engagement page is a
// marketplace surface the installed app never shows, so the Assignments
// section renders nothing there and fetches nothing. Its copy is still kept
// free of contract, rate, payout and invoice, of amounts and of /engagements
// links, in case a dialog is ever reached from a native surface.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="/x">{children}</a>,
}));

import type { Engagement } from "@/services/engagement.service";
import {
	type EngagementAssignment,
	engagementAssignmentsService,
} from "@/services/engagementAssignments.service";
import { TimeApiError } from "@/services/time.service";
import { AssignToProjectDialog } from "./AssignToProjectDialog";
import {
	ASSIGNMENT_COPY,
	accessNeededCopy,
	assignDialogDescription,
	assignedToast,
	assignmentAuthority,
	assignmentEmptyCopy,
	assignmentErrorCopy,
	assignmentGrantNote,
	assignmentSectionDescription,
	endDialogDescription,
	endedToast,
	endWarningCopy,
} from "./assignmentCopy";
import { EndAssignmentDialog } from "./EndAssignmentDialog";
import { EngagementAssignmentsCard } from "./EngagementAssignmentsCard";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe(text: string) {
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	expect(text).not.toMatch(/\/engagements/);
}

function assertDomSafe() {
	assertNativeSafe(document.body.textContent ?? "");
	for (const el of Array.from(document.body.querySelectorAll("[title]"))) {
		assertNativeSafe(el.getAttribute("title") ?? "");
	}
	for (const el of Array.from(document.body.querySelectorAll("a[href]"))) {
		expect(el.getAttribute("href") ?? "").not.toMatch(/\/engagements/);
	}
}

function engagement(over: Partial<Engagement> = {}): Engagement {
	return {
		id: "eng-1",
		kind: "talent_services",
		scope_mode: "project_specific",
		status: "active",
		origin: "contract",
		activated_by_contract_id: "contract-1",
		started_at: "2026-08-01T00:00:00Z",
		ended_at: null,
		cancelled_at: null,
		status_reason: null,
		viewer_position: "hirer",
		viewer_capacity: "consultant",
		counterparty: {
			position: "provider",
			user_id: "talent-1",
			capacity: "talent",
			display_name_snapshot: "Leo Cruz",
			email_snapshot: null,
		},
		project_links: [
			{
				id: "link-1",
				project_id: "p1",
				project_title_snapshot: "Acme Website",
				basis: "contract_scope",
				status: "active",
				linked_at: "2026-08-01T00:00:00Z",
				ended_at: null,
			},
		],
		current_settings: null,
		current_rates: [
			{
				id: "rate-1",
				worker_user_id: "talent-1",
				rate_kind: "cost",
				unit: "hour",
				work_type: null,
				amount: 1200,
				currency: "PHP",
				effective_from: "2026-08-01",
				effective_until: null,
			},
		],
		...over,
	};
}

const ROW: EngagementAssignment = {
	id: "a1",
	engagement_id: "eng-1",
	project_id: "p1",
	project_title_snapshot: "Acme Website",
	worker_user_id: "talent-1",
	worker_label: "Leo Cruz",
	client_engagement_id: null,
	talent_engagement_id: "eng-1",
	team_id: null,
	role_title: null,
	status: "active",
	started_at: "2026-10-01T01:00:00.000Z",
	ended_at: null,
};

function wrap(node: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{node}</QueryClientProvider>,
	);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("Assignments on native", () => {
	it("renders nothing and fetches nothing", () => {
		const list = vi.spyOn(engagementAssignmentsService, "list");
		const { container } = wrap(
			<EngagementAssignmentsCard engagement={engagement()} />,
		);
		expect(container.textContent).toBe("");
		expect(list).not.toHaveBeenCalled();
	});

	it("keeps the assign and end dialogs free of banned words, amounts and links", () => {
		wrap(
			<AssignToProjectDialog
				engagement={engagement()}
				assignments={[]}
				onClose={() => {}}
				onAssigned={() => {}}
			/>,
		);
		expect(screen.getByRole("dialog")).toBeTruthy();
		assertDomSafe();
		cleanup();

		wrap(
			<EndAssignmentDialog
				engagementId="eng-1"
				assignment={ROW}
				workerName="Leo Cruz"
				onClose={() => {}}
				onEnded={() => {}}
			/>,
		);
		assertDomSafe();
	});

	it("keeps every sentence native-safe", () => {
		const seats = [
			engagement(),
			engagement({ viewer_position: "provider" }),
			engagement({ kind: "client_services", viewer_position: "provider" }),
			engagement({ kind: "client_services", viewer_position: "hirer" }),
		];
		const sentences: string[] = [
			...(Object.values(ASSIGNMENT_COPY) as unknown[]).filter(
				(value): value is string => typeof value === "string",
			),
			ASSIGNMENT_COPY.showEnded(2),
			accessNeededCopy("Leo"),
			endWarningCopy("Leo"),
			endWarningCopy(null),
			endDialogDescription("Leo", "Acme Website"),
			endDialogDescription(null, "Acme Website"),
			assignedToast("Leo", "Acme Website"),
			assignedToast(null, "Acme Website"),
			endedToast("Acme Website"),
			...seats.flatMap((seat) => {
				const authority = assignmentAuthority(seat);
				return [
					assignmentSectionDescription(seat),
					assignmentEmptyCopy(seat),
					assignmentGrantNote(authority),
					assignDialogDescription(authority),
				];
			}),
			...[
				"ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED",
				"ASSIGNMENT_ALREADY_ACTIVE",
				"ASSIGNMENT_NOT_ACTIVE",
				"ASSIGNMENT_PROJECT_LINK_REQUIRED",
				"NO_LOGGING_CONTEXT",
				"RETROACTIVE_WINDOW",
				"ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER",
			].map((code) =>
				assignmentErrorCopy(
					new TimeApiError({ status: 422, code: code as never, message: "x" }),
					{ operation: "create", workerName: "Leo" },
				),
			),
			// A server sentence naming a contract is filtered on native.
			assignmentErrorCopy(
				new TimeApiError({
					status: 422,
					code: "CLIENT_ENGAGEMENT_PROJECT_NOT_LINKED" as never,
					message: "The contract doesn't cover this project.",
				}),
				{ operation: "create" },
			),
		];
		for (const sentence of sentences) assertNativeSafe(sentence);
	});
});
