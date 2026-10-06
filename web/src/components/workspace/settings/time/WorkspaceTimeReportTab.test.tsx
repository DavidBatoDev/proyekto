/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

const report = vi.hoisted(() => ({
	props: null as Record<string, unknown> | null,
}));
vi.mock("@/components/time/report/TimeReport", () => ({
	TimeReport: (props: Record<string, unknown>) => {
		report.props = props;
		return <div data-testid="time-report" />;
	},
}));

import type { TimeEntryView } from "@/services/time.types";
import {
	mergeReportSearch,
	reportSearchOf,
	validateWorkspaceTimePageSearch,
	WORKSPACE_REPORT_COPY,
	WorkspaceTimeReportTab,
} from "./WorkspaceTimeReportTab";

const WORKSPACE = {
	id: "w1",
	name: "Acme",
	slug: "acme",
	my_role: "owner" as const,
};
const PERSON = "6d1f6c0e-2f43-4a0e-9d55-3b2e8e1c9a10";

afterEach(() => {
	cleanup();
	report.props = null;
	vi.clearAllMocks();
});

describe("search", () => {
	it("keeps the report's filters on the Report tab only", () => {
		expect(
			validateWorkspaceTimePageSearch({
				tab: "report",
				person: PERSON,
				status: "approved",
				group: "week",
				from: "2026-09-30",
				to: "2026-09-01",
			}),
		).toEqual({
			tab: "report",
			person: PERSON,
			status: "approved",
			group: "week",
			// An inverted range is swapped (W0-C).
			from: "2026-09-01",
			to: "2026-09-30",
		});
		expect(
			validateWorkspaceTimePageSearch({ person: PERSON, status: "approved" }),
		).toEqual({});
		expect(validateWorkspaceTimePageSearch({ tab: "policy" })).toEqual({});
		expect(
			validateWorkspaceTimePageSearch({
				tab: "report",
				person: "not-a-uuid",
				status: "rejected",
			}),
		).toEqual({ tab: "report" });
	});

	it("merges a filter change and drops what was removed", () => {
		const search = {
			tab: "report" as const,
			person: PERSON,
			status: "open" as const,
		};
		expect(reportSearchOf(search)).toEqual({ person: PERSON, status: "open" });
		expect(
			mergeReportSearch(search, { status: undefined, group: "project" }),
		).toEqual({ tab: "report", person: PERSON, group: "project" });
	});
});

describe("WorkspaceTimeReportTab", () => {
	it("mounts the workspace report with the policy's timezone and week start", () => {
		const onSearchChange = vi.fn();
		const onOpenEntry = vi.fn();
		render(
			<WorkspaceTimeReportTab
				workspace={WORKSPACE}
				canManage
				policy={{ timezone: "Asia/Manila", week_start: 7 }}
				search={{ tab: "report", person: PERSON }}
				onSearchChange={onSearchChange}
				onOpenEntry={onOpenEntry}
			/>,
		);
		expect(screen.getByTestId("time-report")).toBeTruthy();
		const props = report.props as Record<string, unknown>;
		expect(props.scope).toEqual({ kind: "workspace", id: "w1" });
		expect(props.search).toEqual({ person: PERSON });
		expect(props.planWorkspace).toEqual({
			id: "w1",
			name: "Acme",
			slug: "acme",
			my_role: "owner",
		});
		expect(props.timezone).toBe("Asia/Manila");
		expect(props.weekStart).toBe(7);

		(props.onSearchChange as (patch: object) => void)({
			person: undefined,
			from: "2026-09-01",
		});
		expect(onSearchChange).toHaveBeenCalledWith({
			tab: "report",
			from: "2026-09-01",
		});
		const entry = { id: "e1" } as TimeEntryView;
		(props.onOpenEntry as (entry: TimeEntryView) => void)(entry);
		expect(onOpenEntry).toHaveBeenCalledWith(entry);
	});

	it("tells a member the report is for owners and admins, with a way back", () => {
		const onShowPolicy = vi.fn();
		render(
			<WorkspaceTimeReportTab
				workspace={{ ...WORKSPACE, my_role: "member" }}
				canManage={false}
				search={{ tab: "report" }}
				onSearchChange={vi.fn()}
				onShowPolicy={onShowPolicy}
			/>,
		);
		expect(screen.queryByTestId("time-report")).toBeNull();
		expect(screen.getByText(WORKSPACE_REPORT_COPY.membersOnly)).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: WORKSPACE_REPORT_COPY.backToPolicy }),
		);
		expect(onShowPolicy).toHaveBeenCalled();
	});
});
