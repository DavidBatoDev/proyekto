/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
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

import { TimeApiError, timeService } from "@/services/time.service";
import type { ResolvedTimePolicy } from "@/services/time.types";
import { WhoApprovesContent, WhoApprovesPopover } from "./WhoApprovesPopover";

function policy(over: Partial<ResolvedTimePolicy> = {}): ResolvedTimePolicy {
	return {
		tracking_enabled: true,
		period_kind: "weekly",
		week_start: 1,
		timezone: "America/New_York",
		period_anchor: null,
		approval_required: true,
		approver_scope: "workspace",
		allow_manual_entries: true,
		retroactive_days: 0,
		rounding_minutes: 15,
		weekly_limit_minutes: 2400,
		reminder_days: 1,
		hidden_presets: [],
		tracking_mode: "optional",
		sources: {
			period_kind: "contract",
			rounding_minutes: "contract",
			weekly_limit_minutes: "contract",
		},
		plan: { time_tracking: true, time_team_rules: false },
		policy_workspace_id: "w",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: "summary",
		...over,
	};
}

const agreement = {
	kind: "assignment" as const,
	id: "a1",
	label: "Acme Corp",
	approver_hint: "hirer" as const,
	engagement_id: "eng-1",
};

function withClient(children: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("WhoApprovesContent", () => {
	it("reads an agreement's terms with a source on each line and View terms on the web", () => {
		const { container } = render(
			<WhoApprovesContent option={agreement} policy={policy()} />,
		);
		expect(screen.getByText("Who approves this time")).toBeTruthy();
		expect(screen.getByText("Goes to: Acme Corp")).toBeTruthy();
		expect(
			screen.getByText("Set by your agreement with Acme Corp"),
		).toBeTruthy();
		expect(
			screen.getByText("Manual time allowed (no limit) · Rounding: 15 min"),
		).toBeTruthy();
		expect(screen.getByText("Weekly limit 40h")).toBeTruthy();
		const keys = Array.from(container.querySelectorAll("[data-line]")).map(
			(li) => li.getAttribute("data-line"),
		);
		expect(keys).toEqual(["goes_to", "timesheet", "rules", "manual", "limits"]);
		expect(screen.getAllByText("Agreement").length).toBeGreaterThan(1);
		const link = screen.getByRole("link", { name: "View terms →" });
		expect(link.getAttribute("href")).toBe("/engagements/eng-1");
	});

	it("has no View terms without the A8 engagement id", () => {
		render(
			<WhoApprovesContent
				option={{ ...agreement, engagement_id: null }}
				policy={policy()}
			/>,
		);
		expect(screen.queryByRole("link")).toBeNull();
	});
});

describe("WhoApprovesPopover", () => {
	it("fetches the option's policy only while open", async () => {
		const getPolicy = vi
			.spyOn(timeService, "getProjectPolicy")
			.mockResolvedValue(policy());
		const anchor = createRef<HTMLButtonElement>();
		const { rerender } = render(
			withClient(
				<>
					<button ref={anchor} type="button">
						chip
					</button>
					<WhoApprovesPopover
						anchorRef={anchor}
						open={false}
						onClose={vi.fn()}
						projectId="p1"
						option={agreement}
					/>
				</>,
			),
		);
		expect(getPolicy).not.toHaveBeenCalled();
		rerender(
			withClient(
				<>
					<button ref={anchor} type="button">
						chip
					</button>
					<WhoApprovesPopover
						anchorRef={anchor}
						open
						onClose={vi.fn()}
						projectId="p1"
						option={agreement}
					/>
				</>,
			),
		);
		await waitFor(() =>
			expect(
				screen.getByText(
					"Timesheet: weekly · starts Monday · America/New_York",
				),
			).toBeTruthy(),
		);
		expect(getPolicy).toHaveBeenCalledWith("p1", {
			kind: "assignment",
			id: "a1",
		});
	});

	it("an old choice that is no longer an option (404) still says where the time went", async () => {
		vi.spyOn(timeService, "getProjectPolicy").mockRejectedValue(
			new TimeApiError({ status: 404, code: "TIME_NOT_FOUND", message: "x" }),
		);
		const anchor = createRef<HTMLButtonElement>();
		render(
			withClient(
				<>
					<button ref={anchor} type="button">
						chip
					</button>
					<WhoApprovesPopover
						anchorRef={anchor}
						open
						onClose={vi.fn()}
						projectId="p1"
						option={{
							kind: "team",
							id: "t1",
							label: "Design",
							approver_hint: "team",
						}}
					/>
				</>,
			),
		);
		expect(
			await screen.findByText("Goes to: Design's owners and admins"),
		).toBeTruthy();
		await waitFor(() => expect(screen.queryByText("Loading")).toBeNull());
		expect(screen.queryByText(/^Timesheet:/)).toBeNull();
	});

	it("never fetches for Just me", () => {
		const getPolicy = vi.spyOn(timeService, "getProjectPolicy");
		const anchor = createRef<HTMLButtonElement>();
		render(
			withClient(
				<>
					<button ref={anchor} type="button">
						chip
					</button>
					<WhoApprovesPopover
						anchorRef={anchor}
						open
						onClose={vi.fn()}
						projectId="p1"
						option={{ kind: "personal", id: null, label: "Just me" }}
						personalReason="plan"
					/>
				</>,
			),
		);
		expect(
			screen.getByText(
				"Your workspace's plan doesn't include timesheets; this time is just for you.",
			),
		).toBeTruthy();
		expect(getPolicy).not.toHaveBeenCalled();
	});
});
