/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4) for Waiting for you and
// Decided: no contract, rate, payout or invoice; no amounts on agreement
// sheets (over-limit time is hours, never money); no /engagements links. Rows
// still link to the review screen, which is an `app` surface.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			params,
			className,
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			className?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			return (
				<a href={href} className={className}>
					{children}
				</a>
			);
		},
	};
});

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

import { timeService } from "@/services/time.service";
import type { ApprovalRow } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import { DecidedList } from "./DecidedList";
import { WaitingForYouList } from "./WaitingForYouList";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe() {
	const text = document.body.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(
		document.body.querySelectorAll("[title],[aria-label]"),
	)) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
		expect(el.getAttribute("aria-label") ?? "").not.toMatch(BANNED);
	}
	expect(document.body.querySelector('a[href*="/engagements"]')).toBeNull();
	for (const link of Array.from(document.body.querySelectorAll("a[href]"))) {
		expect(link.getAttribute("href")).toMatch(/^\/time\/timesheets\//);
	}
}

const TZ = "Asia/Manila";
const NOW = new Date("2026-10-06T03:00:00.000Z");

function row(over: Partial<ApprovalRow> = {}): ApprovalRow {
	return {
		id: "s1",
		member_user_id: "m-leo",
		member_display_name_snapshot: "Leo Cruz",
		scope_kind: "engagement",
		scope_ref: "eng-1",
		team_id: null,
		workspace_id: null,
		engagement_id: "eng-1",
		scope_label_snapshot: "Acme Corp",
		policy_workspace_id: "w-pixel",
		period_kind: "weekly",
		period_start: "2026-09-21",
		period_end: "2026-09-27",
		timezone: TZ,
		week_start: 1,
		status: "submitted",
		approver_scope: "hirer",
		revision: 3,
		submitted_at: "2026-10-05T02:00:00.000Z",
		submitted_by: "m-leo",
		submission_kind: "manual",
		decided_at: null,
		decided_by: null,
		decision_kind: null,
		decision_note: null,
		overtime_approved: false,
		total_seconds: 156_600,
		payable_seconds: null,
		origin: "app",
		created_at: "2026-09-21T01:00:00.000Z",
		updated_at: "2026-10-05T02:00:00.000Z",
		entry_count: 6,
		running_count: 0,
		logged_seconds: 156_600,
		member: { id: "m-leo", display_name: "Leo Cruz", avatar_url: null },
		policy_workspace: { id: "w-pixel", name: "Pixel Studio" },
		flags: { needs_review: 1, over_cap_seconds: 12_600, running: 0 },
		...over,
	};
}

let client: QueryClient;

beforeEach(() => {
	useAuthStore.setState({ user: { id: "decider-1" } as never });
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
	cleanup();
	client.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("native: approvals", () => {
	it("Waiting for you on agreement sheets stays native-safe", async () => {
		vi.spyOn(timeService, "listApprovals").mockResolvedValue({
			items: [
				row(),
				row({
					id: "s2",
					flags: { needs_review: 0, over_cap_seconds: 0, running: 0 },
					flags_partial: true,
				}),
				row({
					id: "s3",
					member_user_id: "m-ana",
					member: { id: "m-ana", display_name: "Ana Lim", avatar_url: null },
					scope_kind: "team",
					scope_label_snapshot: "Design Team",
					flags: { needs_review: 0, over_cap_seconds: 0, running: 0 },
				}),
			],
			total: 3,
			page: 1,
			limit: 100,
		});
		render(
			<QueryClientProvider client={client}>
				<WaitingForYouList
					currentWorkspaceId="w-acme"
					now={NOW}
					userTimezone={TZ}
				/>
			</QueryClientProvider>,
		);
		await screen.findAllByTestId("waiting-row");
		expect(screen.getAllByTestId("waiting-over")[0].textContent).toBe(
			"+3h 30m",
		);
		assertNativeSafe();
	});

	it("Decided stays native-safe", async () => {
		vi.spyOn(timeService, "listApprovals").mockResolvedValue({
			items: [
				row({
					status: "approved",
					decided_by: "decider-1",
					decided_at: "2026-09-29T02:00:00.000Z",
					overtime_approved: true,
				}),
				row({
					id: "s2",
					status: "returned",
					decided_by: "decider-1",
					decision_note: "Split Thursday",
				}),
			],
			total: 2,
			page: 1,
			limit: 50,
		});
		render(
			<QueryClientProvider client={client}>
				<DecidedList currentWorkspaceId="w-acme" now={NOW} userTimezone={TZ} />
			</QueryClientProvider>,
		);
		await screen.findAllByTestId("decided-row");
		expect(
			screen.getByText("Approved by you · Sep 29 · Overtime approved"),
		).toBeTruthy();
		assertNativeSafe();
	});
});
