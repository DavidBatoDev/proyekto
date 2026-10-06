import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAccessDeniedError } from "@/lib/apiErrors";
import {
	parsePlanLimitError,
	resetPlanLimitNotifications,
	setPlanLimitNotifier,
} from "@/lib/planLimitErrors";

const client = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	patch: vi.fn(),
	delete: vi.fn(),
}));

vi.mock("@/api/axios", () => ({ default: client }));

import {
	collectAllPages,
	filenameFromDisposition,
	isTimeApiError,
	listAllMyEntries,
	parseForParam,
	TimeApiError,
	timeRequest,
	timeService,
	toForParam,
	toTimeApiError,
	unwrapTimeResponse,
} from "./time.service";
import type { LoggingOption, Paged } from "./time.types";

const TEAM = "11111111-1111-4111-8111-111111111111";
const ENTRY = "22222222-2222-4222-8222-222222222222";
const SHEET = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const WS = "55555555-5555-4555-8555-555555555555";

/** What axios rejects with once HttpExceptionFilter has shaped the body. */
function httpError(status: number, error: Record<string, unknown>) {
	return Object.assign(new Error(`Request failed with status code ${status}`), {
		isAxiosError: true,
		response: {
			status,
			data: {
				error: {
					...error,
					status,
					path: "/api/time/x",
					timestamp: "2026-10-06T00:00:00.000Z",
				},
			},
		},
	});
}

const ok = (data: unknown) => ({ data: { data }, headers: {} });

const OPTION: LoggingOption = {
	kind: "team",
	id: TEAM,
	label: "Design team",
	sheet_scope: { kind: "team", ref: TEAM },
	rate_source: "team_member_rates",
	workspace_tag: null,
	approver_hint: "team",
};

beforeEach(() => {
	for (const fn of Object.values(client)) fn.mockReset();
});

afterEach(() => {
	resetPlanLimitNotifications();
});

describe("unwrap", () => {
	it("returns null for `{ data: null }`, never the envelope", async () => {
		client.get.mockResolvedValue(ok(null));
		await expect(timeService.getRunning()).resolves.toBeNull();
		expect(client.get).toHaveBeenCalledWith("/api/time/me/running", {});
	});

	it("unwraps the payload", async () => {
		const overview = {
			can_log: true,
			approver_mode: false,
			contexts: [],
			approvals_waiting: 2,
			workspace_time_admin: [],
		};
		client.get.mockResolvedValue(ok(overview));
		await expect(timeService.getOverview()).resolves.toEqual(overview);
	});

	it("tolerates an un-enveloped body and an empty one", () => {
		expect(unwrapTimeResponse({ waiting: 3 })).toEqual({ waiting: 3 });
		expect(unwrapTimeResponse(undefined)).toBeNull();
		expect(unwrapTimeResponse("")).toBe("");
	});

	it("answers [] when segments or comments come back null", async () => {
		client.get.mockResolvedValue(ok(null));
		await expect(timeService.listEntrySegments(ENTRY)).resolves.toEqual([]);
		await expect(timeService.listEntryComments(ENTRY)).resolves.toEqual([]);
	});

	it("resolves a DELETE without a body to undefined", async () => {
		client.delete.mockResolvedValue({ data: {}, headers: {} });
		await expect(timeService.deleteEntry(ENTRY)).resolves.toBeUndefined();
		expect(client.delete).toHaveBeenCalledWith(
			`/api/time/entries/${ENTRY}`,
			{},
		);
	});
});

describe("errors", () => {
	it("keeps the code, status, message and extras of a flow 409", async () => {
		client.post.mockRejectedValue(
			httpError(409, {
				code: "LOGGING_FOR_REQUIRED",
				message: "Choose who this time is for.",
				options: [OPTION],
				prefill: null,
			}),
		);

		const caught = await timeService
			.startEntry({ project_id: PROJECT })
			.catch((error: unknown) => error);

		expect(caught).toBeInstanceOf(TimeApiError);
		const error = caught as TimeApiError;
		expect(error.status).toBe(409);
		expect(error.code).toBe("LOGGING_FOR_REQUIRED");
		expect(error.message).toBe("Choose who this time is for.");
		// The filter's own keys never reach the extras.
		expect(error.extras).toEqual({ options: [OPTION], prefill: null });
		expect(isTimeApiError(error, "LOGGING_FOR_REQUIRED")).toBe(true);
		expect(isTimeApiError(error, "STALE_REVISION")).toBe(false);
		if (isTimeApiError(error, "LOGGING_FOR_REQUIRED")) {
			expect(error.extras.options[0].label).toBe("Design team");
		}
	});

	it("keeps the period-lock extras (sheet_status, never status)", async () => {
		client.post.mockRejectedValue(
			httpError(409, {
				code: "TIMESHEET_LOCKED",
				message:
					"This period's timesheet is submitted. Withdraw it to add time.",
				reason: "period",
				timesheet_id: SHEET,
				sheet_status: "submitted",
			}),
		);
		const error = (await timeService
			.createEntry({
				project_id: PROJECT,
				started_at: "2026-10-05T01:00:00Z",
				ended_at: "2026-10-05T02:00:00Z",
			})
			.catch((e: unknown) => e)) as TimeApiError<"TIMESHEET_LOCKED">;
		expect(error.extras).toEqual({
			reason: "period",
			timesheet_id: SHEET,
			sheet_status: "submitted",
		});
	});

	it("reads a 500 TIME_INTERNAL with the fixed Proyekto copy", async () => {
		client.patch.mockRejectedValue(
			httpError(500, {
				code: "TIME_INTERNAL",
				message: "Proyekto couldn't save this time. Try again.",
			}),
		);
		const error = (await timeService
			.updateEntry(ENTRY, {
				note: "x",
				expected_updated_at: "2026-10-05T00:00:00Z",
			})
			.catch((e: unknown) => e)) as TimeApiError;
		expect(error.status).toBe(500);
		expect(error.code).toBe("TIME_INTERNAL");
		expect(error.message).toBe("Proyekto couldn't save this time. Try again.");
		expect(error.extras).toEqual({});
	});

	it("names a codeless 400 HTTP_400 and drops Nest's status text", async () => {
		client.post.mockRejectedValue(
			httpError(400, {
				error: "Bad Request",
				message: "Add a note so the person knows what to change.",
			}),
		);
		const error = (await timeService
			.returnTimesheet(SHEET, { expected_revision: 2, note: "" })
			.catch((e: unknown) => e)) as TimeApiError;
		expect(error.code).toBe("HTTP_400");
		expect(error.status).toBe(400);
		expect(error.message).toBe(
			"Add a note so the person knows what to change.",
		);
		expect(error.extras).toEqual({});
	});

	it("joins a raw class-validator message array", () => {
		const error = toTimeApiError({
			response: {
				status: 400,
				data: { message: ["from must be a date", "to must be a date"] },
			},
		});
		expect(error.code).toBe("HTTP_400");
		expect(error.message).toBe("from must be a date; to must be a date");
	});

	it("reads a request with no response as NETWORK_ERROR, status 0", async () => {
		client.get.mockRejectedValue(
			Object.assign(new Error("Network Error"), {
				isAxiosError: true,
				request: {},
			}),
		);
		const error = (await timeService
			.getRunning()
			.catch((e: unknown) => e)) as TimeApiError;
		expect(error.code).toBe("NETWORK_ERROR");
		expect(error.status).toBe(0);
		expect(error.message).not.toBe("Network Error");
	});

	it("reads a non-HTTP throw as CLIENT_ERROR", () => {
		const error = toTimeApiError(new TypeError("boom"));
		expect(error.code).toBe("CLIENT_ERROR");
		expect(error.message).toBe("boom");
	});

	it("keeps a plan-limit 403 readable by the shared parsers", async () => {
		client.put.mockRejectedValue(
			httpError(403, {
				code: "plan_limit",
				kind: "feature",
				limit_key: "time_team_rules",
				label: "Team time rules",
				plan: "pro",
				upgrade_plan: "business",
				workspace_id: WS,
				message: "Team approvers and team time rules are part of Business.",
			}),
		);
		const error = (await timeService
			.updateTeamPolicy(TEAM, { rounding_minutes: 15 })
			.catch((e: unknown) => e)) as TimeApiError;
		expect(error.code).toBe("plan_limit");
		expect(error.planLimit).toMatchObject({
			limitKey: "time_team_rules",
			upgradePlan: "business",
			workspaceId: WS,
		});
		expect(parsePlanLimitError(error)?.limitKey).toBe("time_team_rules");
		expect(isAccessDeniedError(error)).toBe(true);
	});

	it("is idempotent on an error that is already a TimeApiError", () => {
		const first = toTimeApiError(
			httpError(404, { code: "TIME_NOT_FOUND", message: "x" }),
		);
		expect(toTimeApiError(first)).toBe(first);
		expect(first.cause).toBeDefined();
	});
});

describe("params and bodies", () => {
	it("serialises the For filter, dropping empty values", async () => {
		const page: Paged<unknown> = { items: [], total: 0, page: 1, limit: 100 };
		client.get.mockResolvedValue(ok(page));

		await timeService.listMyEntries({
			from: "2026-09-29",
			to: "2026-10-05",
			for: { kind: "personal" },
			project_id: undefined,
		});
		expect(client.get).toHaveBeenLastCalledWith("/api/time/me/entries", {
			params: { from: "2026-09-29", to: "2026-10-05", for: "personal:" },
		});

		await timeService.listMyEntries({
			from: "2026-09-29",
			to: "2026-10-05",
			for: { kind: "team", id: TEAM },
			page: 2,
			limit: 200,
		});
		expect(client.get).toHaveBeenLastCalledWith("/api/time/me/entries", {
			params: {
				from: "2026-09-29",
				to: "2026-10-05",
				for: `team:${TEAM}`,
				page: 2,
				limit: 200,
			},
		});
	});

	it("serialises report scopes and the week grouping", async () => {
		client.get.mockResolvedValue(ok({ groups: [] }));
		await timeService.getReportSummary({
			scope: { kind: "team", id: TEAM },
			from: "2026-09-01",
			to: "2026-09-30",
			group_by: "week",
			status: "approved",
		});
		expect(client.get).toHaveBeenCalledWith("/api/time/reports/summary", {
			params: {
				scope: `team:${TEAM}`,
				from: "2026-09-01",
				to: "2026-09-30",
				status: "approved",
				group_by: "week",
			},
		});
	});

	it("sends `at` as an ISO instant and the policy option as `for`", async () => {
		client.get.mockResolvedValue(ok({}));
		await timeService.getLoggingFor(PROJECT, {
			at: new Date("2026-10-06T03:00:00Z"),
		});
		expect(client.get).toHaveBeenLastCalledWith(
			`/api/time/projects/${PROJECT}/logging-for`,
			{ params: { at: "2026-10-06T03:00:00.000Z" } },
		);

		await timeService.getLoggingFor(PROJECT);
		expect(client.get).toHaveBeenLastCalledWith(
			`/api/time/projects/${PROJECT}/logging-for`,
			{},
		);

		await timeService.getProjectPolicy(PROJECT, { kind: "personal", id: null });
		expect(client.get).toHaveBeenLastCalledWith(
			`/api/time/projects/${PROJECT}/policy`,
			{ params: { for: "personal:" } },
		);
	});

	it("sends the overview timezone and approval filters", async () => {
		client.get.mockResolvedValue(ok({}));
		await timeService.getOverview({ tz: "Asia/Manila" });
		expect(client.get).toHaveBeenLastCalledWith("/api/time/me/overview", {
			params: { tz: "Asia/Manila" },
		});

		await timeService.listApprovals({ status: "decided", since: "2026-09-01" });
		expect(client.get).toHaveBeenLastCalledWith("/api/time/approvals", {
			params: { status: "decided", since: "2026-09-01" },
		});
	});

	it("sends only the DTO's keys, so a spread never trips forbidNonWhitelisted", async () => {
		client.put.mockResolvedValue(ok({}));
		client.post.mockResolvedValue(ok({}));
		client.patch.mockResolvedValue(ok({}));
		// A policy view spread back into a PUT (the W2-3 trap).
		const view = {
			period_kind: "weekly",
			week_start: 1,
			timezone: "Asia/Manila",
			approval_required: true,
			sources: { period_kind: "workspace" },
			plan: { time_tracking: true },
			tracking_mode: "required",
			policy_workspace_id: WS,
			retroactive_days: null,
		};
		await timeService.updateWorkspacePolicy(WS, {
			...(view as object),
			confirm: true,
		});
		expect(client.put).toHaveBeenLastCalledWith(
			`/api/time/policies/workspaces/${WS}`,
			{
				period_kind: "weekly",
				week_start: 1,
				timezone: "Asia/Manila",
				approval_required: true,
				retroactive_days: null,
				confirm: true,
			},
			{},
		);

		await timeService.updateTeamPolicy(TEAM, {
			...({ rounding_minutes: 15, can_edit: true } as object),
			week_start: null,
		});
		expect(client.put).toHaveBeenLastCalledWith(
			`/api/time/policies/teams/${TEAM}`,
			{ rounding_minutes: 15, week_start: null },
			{},
		);

		// A whole option as the For: only { kind, id } goes (nested DTO).
		await timeService.startEntry({
			project_id: PROJECT,
			task_id: null,
			logging_for: OPTION,
			...({ warnings: [] } as object),
		});
		expect(client.post).toHaveBeenLastCalledWith(
			"/api/time/entries/start",
			{
				project_id: PROJECT,
				task_id: null,
				logging_for: { kind: "team", id: TEAM },
			},
			{},
		);

		await timeService.createEntry({
			project_id: PROJECT,
			started_at: "2026-10-05T01:00:00Z",
			ended_at: "2026-10-05T02:00:00Z",
			logging_for: { kind: "personal" },
			...({ id: ENTRY } as object),
		});
		expect(client.post).toHaveBeenLastCalledWith(
			"/api/time/entries",
			{
				project_id: PROJECT,
				started_at: "2026-10-05T01:00:00Z",
				ended_at: "2026-10-05T02:00:00Z",
				logging_for: { kind: "personal", id: null },
			},
			{},
		);

		await timeService.updateEntry(ENTRY, {
			note: null,
			expected_updated_at: "2026-10-05T00:00:00Z",
			...({ updated_at: "2026-10-05T00:00:00Z", status: "x" } as object),
		});
		expect(client.patch).toHaveBeenLastCalledWith(
			`/api/time/entries/${ENTRY}`,
			{ note: null, expected_updated_at: "2026-10-05T00:00:00Z" },
			{},
		);
	});

	it("puts the For choice under logging_for, personal with a null id", async () => {
		client.put.mockResolvedValue(ok({}));
		await timeService.setLoggingFor(PROJECT, { kind: "personal" });
		expect(client.put).toHaveBeenCalledWith(
			`/api/time/projects/${PROJECT}/logging-for`,
			{ logging_for: { kind: "personal", id: null } },
			{},
		);
	});

	it("keeps a stored week start unless one is sent", async () => {
		client.put.mockResolvedValue(ok({}));
		await timeService.setPreferences({ timezone: "Asia/Manila" });
		expect(client.put).toHaveBeenLastCalledWith(
			"/api/time/me/preferences",
			{ timezone: "Asia/Manila" },
			{},
		);
		await timeService.setPreferences({ timezone: "UTC", week_start: 7 });
		expect(client.put).toHaveBeenLastCalledWith(
			"/api/time/me/preferences",
			{ timezone: "UTC", week_start: 7 },
			{},
		);
	});

	it("posts an empty body to stop, pause and resume", async () => {
		client.post.mockResolvedValue(ok({ id: ENTRY }));
		await timeService.stopEntry(ENTRY);
		await timeService.pauseEntry(ENTRY);
		await timeService.resumeEntry(ENTRY);
		expect(client.post.mock.calls).toEqual([
			[`/api/time/entries/${ENTRY}/stop`, {}, {}],
			[`/api/time/entries/${ENTRY}/pause`, {}, {}],
			[`/api/time/entries/${ENTRY}/resume`, {}, {}],
		]);
	});

	it("routes every timesheet action to its path", async () => {
		client.post.mockResolvedValue(ok({ id: SHEET }));
		const body = { expected_revision: 3 };
		await timeService.submitTimesheet(SHEET, body);
		await timeService.withdrawTimesheet(SHEET, body);
		await timeService.approveTimesheet(SHEET, {
			...body,
			approve_overtime: true,
		});
		await timeService.returnTimesheet(SHEET, { ...body, note: "Fix Tuesday" });
		await timeService.reopenTimesheet(SHEET, body);
		await timeService.requestReopenTimesheet(SHEET, body);
		await timeService.approveTimesheetsBulk({
			ids: [SHEET],
			expected_revisions: [3],
		});
		expect(client.post.mock.calls.map((call) => call[0])).toEqual([
			`/api/time/timesheets/${SHEET}/submit`,
			`/api/time/timesheets/${SHEET}/withdraw`,
			`/api/time/timesheets/${SHEET}/approve`,
			`/api/time/timesheets/${SHEET}/return`,
			`/api/time/timesheets/${SHEET}/reopen`,
			`/api/time/timesheets/${SHEET}/request-reopen`,
			"/api/time/timesheets/approve-bulk",
		]);
		expect(client.post.mock.calls[2][1]).toEqual({
			expected_revision: 3,
			approve_overtime: true,
		});
	});

	it("covers the remaining routes", async () => {
		client.get.mockResolvedValue(ok({}));
		client.put.mockResolvedValue(ok({}));
		client.delete.mockResolvedValue(ok({}));
		await timeService.getWorkItems(PROJECT);
		await timeService.getProjectLoggers(PROJECT);
		await timeService.listMyProjects();
		await timeService.listMyTimesheets({ from: "2026-09-01" });
		await timeService.getMySummary({ from: "2026-09-01", to: "2026-09-30" });
		await timeService.getPreferences();
		await timeService.getEntry(ENTRY);
		await timeService.getTimesheet(SHEET);
		await timeService.getApprovalsCount();
		await timeService.getWorkspacePolicy(WS, { tz: "Asia/Manila" });
		await timeService.getWorkspacePolicyHistory(WS, { page: 2 });
		await timeService.getTeamPolicy(TEAM);
		await timeService.updateWorkspacePolicy(WS, { confirm: true });
		await timeService.deleteTeamPolicy(TEAM);
		expect(client.get.mock.calls).toEqual([
			[`/api/time/projects/${PROJECT}/work-items`, {}],
			[`/api/time/projects/${PROJECT}/loggers`, {}],
			["/api/time/me/projects", {}],
			["/api/time/me/timesheets", { params: { from: "2026-09-01" } }],
			[
				"/api/time/me/summary",
				{ params: { from: "2026-09-01", to: "2026-09-30" } },
			],
			["/api/time/me/preferences", {}],
			[`/api/time/entries/${ENTRY}`, {}],
			[`/api/time/timesheets/${SHEET}`, {}],
			["/api/time/approvals/count", {}],
			[
				`/api/time/policies/workspaces/${WS}`,
				{ params: { tz: "Asia/Manila" } },
			],
			[`/api/time/policies/workspaces/${WS}/history`, { params: { page: 2 } }],
			[`/api/time/policies/teams/${TEAM}`, {}],
		]);
		expect(client.put).toHaveBeenCalledWith(
			`/api/time/policies/workspaces/${WS}`,
			{ confirm: true },
			{},
		);
		expect(client.delete).toHaveBeenCalledWith(
			`/api/time/policies/teams/${TEAM}`,
			{},
		);
	});

	it("escapes ids in paths", async () => {
		client.get.mockResolvedValue(ok({}));
		await timeService.getEntry("../me/running");
		expect(client.get).toHaveBeenCalledWith(
			"/api/time/entries/..%2Fme%2Frunning",
			{},
		);
	});

	it("timeRequest prefixes /api/time and unwraps", async () => {
		client.get.mockResolvedValue(ok({ waiting: 1 }));
		await expect(
			timeRequest<{ waiting: number }>("get", "approvals/count"),
		).resolves.toEqual({ waiting: 1 });
		expect(client.get).toHaveBeenCalledWith("/api/time/approvals/count", {});
	});
});

describe("For params", () => {
	it("writes the API and URL forms", () => {
		expect(toForParam({ kind: "personal" })).toBe("personal:");
		expect(toForParam({ kind: "personal", id: null }, "url")).toBe("personal");
		expect(toForParam({ kind: "team", id: TEAM })).toBe(`team:${TEAM}`);
		expect(toForParam({ kind: "assignment", id: TEAM }, "url")).toBe(
			`assignment:${TEAM}`,
		);
		expect(toForParam({ kind: "workspace", id: null })).toBeUndefined();
		expect(toForParam(null)).toBeUndefined();
	});

	it("reads both personal forms and refuses anything else", () => {
		expect(parseForParam("personal")).toEqual({ kind: "personal", id: null });
		expect(parseForParam("personal:")).toEqual({ kind: "personal", id: null });
		expect(parseForParam(`team:${TEAM}`)).toEqual({ kind: "team", id: TEAM });
		expect(parseForParam(`workspace:${WS}`)).toEqual({
			kind: "workspace",
			id: WS,
		});
		expect(parseForParam("team:not-a-uuid")).toBeNull();
		expect(parseForParam(`project:${TEAM}`)).toBeNull();
		expect(parseForParam(`personal:${TEAM}`)).toBeNull();
		expect(parseForParam("all")).toBeNull();
		expect(parseForParam("")).toBeNull();
		expect(parseForParam(undefined)).toBeNull();
	});

	it("round-trips", () => {
		for (const ref of [
			{ kind: "personal" as const, id: null },
			{ kind: "team" as const, id: TEAM },
		]) {
			expect(parseForParam(toForParam(ref))).toEqual(ref);
			expect(parseForParam(toForParam(ref, "url"))).toEqual(ref);
		}
	});
});

describe("exports", () => {
	it("returns the blob with the server's filename", async () => {
		const blob = new Blob(["a,b\n"], { type: "text/csv" });
		client.get.mockResolvedValue({
			data: blob,
			headers: {
				"content-type": "text/csv; charset=utf-8",
				"content-disposition": 'attachment; filename="time-team-sep.csv"',
			},
		});
		const file = await timeService.exportReport({
			scope: { kind: "team", id: TEAM },
			from: "2026-09-01",
			to: "2026-09-30",
		});
		expect(file).toEqual({
			blob,
			filename: "time-team-sep.csv",
			contentType: "text/csv; charset=utf-8",
		});
		expect(client.get).toHaveBeenCalledWith("/api/time/reports/export", {
			params: {
				scope: `team:${TEAM}`,
				from: "2026-09-01",
				to: "2026-09-30",
				format: "csv",
			},
			responseType: "blob",
		});
	});

	it("falls back to a name built from the query when the header is hidden", async () => {
		const blob = new Blob(["x"], {
			type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		});
		client.get.mockResolvedValue({ data: blob, headers: {} });
		const file = await timeService.exportAudit({
			workspace_id: WS,
			from: "2026-09-01",
			to: "2026-09-30",
			format: "xlsx",
		});
		expect(file.filename).toBe(
			"proyekto-time-audit-2026-09-01-to-2026-09-30.xlsx",
		);
		expect(file.contentType).toBe(blob.type);
		expect(client.get.mock.calls[0][1].params.scope).toBe(`workspace:${WS}`);
	});

	it("decodes a Blob error body and raises the upgrade prompt", async () => {
		const notifier = vi.fn();
		setPlanLimitNotifier(notifier);
		const body = {
			error: {
				code: "plan_limit",
				kind: "feature",
				limit_key: "time_reports_export",
				plan: "pro",
				upgrade_plan: "business",
				workspace_id: WS,
				message: "Workspace-wide time reports and export are part of Business.",
				status: 403,
			},
		};
		client.get.mockRejectedValue(
			Object.assign(new Error("Request failed with status code 403"), {
				isAxiosError: true,
				response: {
					status: 403,
					data: new Blob([JSON.stringify(body)], { type: "application/json" }),
				},
			}),
		);
		const error = (await timeService
			.exportReport({
				scope: { kind: "workspace", id: WS },
				from: "2026-09-01",
				to: "2026-09-30",
			})
			.catch((e: unknown) => e)) as TimeApiError;
		expect(error).toBeInstanceOf(TimeApiError);
		expect(error.code).toBe("plan_limit");
		expect(error.message).toBe(
			"Workspace-wide time reports and export are part of Business.",
		);
		expect(notifier).toHaveBeenCalledTimes(1);
		expect(notifier.mock.calls[0][0]).toMatchObject({
			limitKey: "time_reports_export",
		});
	});

	it("decodes a Blob 400 (range too long) without a prompt", async () => {
		const notifier = vi.fn();
		setPlanLimitNotifier(notifier);
		client.get.mockRejectedValue({
			isAxiosError: true,
			response: {
				status: 400,
				data: new Blob([
					JSON.stringify({
						error: { message: "Pick a shorter range.", status: 400 },
					}),
				]),
			},
		});
		const error = (await timeService
			.exportReport({
				scope: { kind: "team", id: TEAM },
				from: "2025-01-01",
				to: "2026-09-30",
			})
			.catch((e: unknown) => e)) as TimeApiError;
		expect(error.code).toBe("HTTP_400");
		expect(error.message).toBe("Pick a shorter range.");
		expect(notifier).not.toHaveBeenCalled();
	});

	it("parses Content-Disposition forms", () => {
		expect(filenameFromDisposition('attachment; filename="a b.csv"')).toBe(
			"a b.csv",
		);
		expect(filenameFromDisposition("attachment; filename=plain.csv")).toBe(
			"plain.csv",
		);
		expect(
			filenameFromDisposition(
				"attachment; filename=\"fallback.csv\"; filename*=UTF-8''r%C3%A9sum%C3%A9.csv",
			),
		).toBe("résumé.csv");
		expect(filenameFromDisposition("attachment")).toBeNull();
		expect(filenameFromDisposition(undefined)).toBeNull();
	});
});

describe("pagers", () => {
	it("walks pages until the total", async () => {
		const pages: Record<number, number[]> = { 1: [1, 2], 2: [3, 4], 3: [5] };
		const fetchPage = vi.fn(async (page: number, limit: number) => ({
			items: pages[page] ?? [],
			total: 5,
			page,
			limit,
		}));
		await expect(collectAllPages(fetchPage, { limit: 2 })).resolves.toEqual([
			1, 2, 3, 4, 5,
		]);
		expect(fetchPage).toHaveBeenCalledTimes(3);
	});

	it("stops on an empty page even when the total lies", async () => {
		const fetchPage = vi.fn(async (page: number, limit: number) => ({
			items: page === 1 ? [1, 2] : [],
			total: 99,
			page,
			limit,
		}));
		await expect(collectAllPages(fetchPage, { limit: 2 })).resolves.toEqual([
			1, 2,
		]);
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it("caps at maxItems", async () => {
		const fetchPage = vi.fn(async (page: number, limit: number) => ({
			items: [page * 10, page * 10 + 1],
			total: 1000,
			page,
			limit,
		}));
		await expect(
			collectAllPages(fetchPage, { limit: 2, maxItems: 3 }),
		).resolves.toEqual([10, 11, 20]);
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it("listAllMyEntries pages me/entries at 200", async () => {
		client.get
			.mockResolvedValueOnce(
				ok({
					items: Array.from({ length: 200 }, (_, i) => ({ id: `e${i}` })),
					total: 201,
					page: 1,
					limit: 200,
				}),
			)
			.mockResolvedValueOnce(
				ok({ items: [{ id: "e200" }], total: 201, page: 2, limit: 200 }),
			);
		const rows = await listAllMyEntries({
			from: "2026-09-01",
			to: "2026-09-30",
		});
		expect(rows).toHaveLength(201);
		expect(client.get.mock.calls.map((call) => call[1].params.page)).toEqual([
			1, 2,
		]);
		expect(client.get.mock.calls[0][1].params.limit).toBe(200);
	});
});
