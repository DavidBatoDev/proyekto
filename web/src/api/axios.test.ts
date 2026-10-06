import {
	AxiosError,
	type AxiosResponse,
	type InternalAxiosRequestConfig,
} from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resetPlanLimitNotifications,
	setPlanLimitNotifier,
} from "@/lib/planLimitErrors";

// The request interceptor reads the Supabase session; no real client here.
vi.mock("@/lib/supabase", () => ({
	getAccessToken: vi.fn(async () => "token"),
}));

import apiClient, { setPermissionToastHandler } from "./axios";

/** An adapter that answers every request with `status` and `data`. */
function failingAdapter(status: number, data: unknown) {
	const created: { error: AxiosError | null } = { error: null };
	const adapter = (config: InternalAxiosRequestConfig) => {
		const response = {
			status,
			statusText: "",
			headers: {},
			config,
			data,
		} as AxiosResponse;
		created.error = new AxiosError(
			`Request failed with status code ${status}`,
			"ERR_BAD_REQUEST",
			config,
			null,
			response,
		);
		return Promise.reject(created.error);
	};
	return { adapter, created };
}

const planLimitBody = {
	error: {
		code: "plan_limit",
		kind: "count",
		limit_key: "teams",
		label: "Teams",
		limit: 2,
		used: 2,
		plan: "free",
		upgrade_plan: "pro",
		workspace_id: "ws-1",
		workspace_slug: "acme",
		context: "create",
		message: "Your Free plan includes 2 teams.",
		status: 403,
		path: "/api/teams",
	},
};

const notifier = vi.fn();
const permissionToast = vi.fn();

beforeEach(() => {
	setPlanLimitNotifier(notifier);
	setPermissionToastHandler(permissionToast);
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	resetPlanLimitNotifications();
	setPermissionToastHandler(null);
	vi.restoreAllMocks();
	notifier.mockReset();
	permissionToast.mockReset();
});

describe("axios 403 handling", () => {
	it("raises the plan-limit prompt and still rejects with the same error", async () => {
		const { adapter, created } = failingAdapter(403, planLimitBody);

		const caught = await apiClient
			.post("/api/teams", { name: "Ops" }, { adapter })
			.catch((error: unknown) => error);

		expect(created.error).not.toBeNull();
		expect(caught).toBe(created.error);
		expect(notifier).toHaveBeenCalledTimes(1);
		expect(notifier.mock.calls[0][0]).toMatchObject({
			limitKey: "teams",
			plan: "free",
			upgradePlan: "pro",
			workspaceId: "ws-1",
			message: "Your Free plan includes 2 teams.",
		});
		// A plan limit is not a permission problem.
		expect(permissionToast).not.toHaveBeenCalled();
	});

	it("handles a plan limit even on a URL the team-time rule would skip", async () => {
		const { adapter } = failingAdapter(403, planLimitBody);

		await expect(
			apiClient.get("/api/team-time/teams/t-1/tasks", { adapter }),
		).rejects.toBeInstanceOf(AxiosError);
		expect(notifier).toHaveBeenCalledTimes(1);
	});

	it("keeps the missing-permission toast for other 403s", async () => {
		const { adapter, created } = failingAdapter(403, {
			code: "missing_permission",
			message: "Nope",
			path: null,
			label: "edit the roadmap",
			requiredRole: null,
		});

		const caught = await apiClient
			.patch("/api/roadmaps/r-1", {}, { adapter })
			.catch((error: unknown) => error);

		expect(caught).toBe(created.error);
		expect(notifier).not.toHaveBeenCalled();
		expect(permissionToast).toHaveBeenCalledTimes(1);
		expect(permissionToast.mock.calls[0][0]).toContain("edit the roadmap");
	});

	it("keeps the team-time 403 silence for the alias", async () => {
		const { adapter } = failingAdapter(403, {
			code: "missing_permission",
			message: "Nope",
			path: null,
			label: "see team time",
			requiredRole: null,
		});

		await expect(
			apiClient.get("/api/team-time/teams/t-1/my-rate", { adapter }),
		).rejects.toBeInstanceOf(AxiosError);
		expect(permissionToast).not.toHaveBeenCalled();
		expect(console.error).not.toHaveBeenCalled();
	});

	it("never toasts or logs a time 403 the time UI answers in place", async () => {
		for (const code of ["NO_LOGGING_CONTEXT", "MANUAL_ENTRIES_DISABLED"]) {
			const { adapter, created } = failingAdapter(403, {
				error: {
					code,
					message: "You can't log time on this project.",
					status: 403,
					path: "/api/time/entries/start",
				},
			});

			const caught = await apiClient
				.post("/api/time/entries/start", {}, { adapter })
				.catch((error: unknown) => error);

			expect(caught).toBe(created.error);
		}
		expect(permissionToast).not.toHaveBeenCalled();
		expect(notifier).not.toHaveBeenCalled();
		expect(console.error).not.toHaveBeenCalled();
	});

	it("still raises the upgrade prompt for a time plan limit", async () => {
		const { adapter } = failingAdapter(403, {
			error: { ...planLimitBody.error, limit_key: "time_team_rules" },
		});

		await expect(
			apiClient.put("/api/time/policies/teams/t-1", {}, { adapter }),
		).rejects.toBeInstanceOf(AxiosError);
		expect(notifier).toHaveBeenCalledTimes(1);
		expect(notifier.mock.calls[0][0]).toMatchObject({
			limitKey: "time_team_rules",
		});
	});

	it("still logs a time 403 that is not a time code", async () => {
		const { adapter } = failingAdapter(403, {
			error: { code: "SOMETHING_ELSE", message: "x", status: 403 },
		});

		await expect(
			apiClient.get("/api/time/me/overview", { adapter }),
		).rejects.toBeInstanceOf(AxiosError);
		expect(console.error).toHaveBeenCalled();
	});

	it("never treats another status as a plan limit", async () => {
		const { adapter } = failingAdapter(409, planLimitBody);

		await expect(
			apiClient.post("/api/teams", {}, { adapter }),
		).rejects.toBeInstanceOf(AxiosError);
		expect(notifier).not.toHaveBeenCalled();
	});
});

describe("axios 409 handling for /api/time", () => {
	const conflict = (code: string) => ({
		error: { code, message: "x", status: 409, path: "/api/time/entries/start" },
	});

	it("does not console-error the flow codes", async () => {
		for (const code of [
			"LOGGING_FOR_REQUIRED",
			"STALE_REVISION",
			"TIMER_ALREADY_RUNNING",
		]) {
			const { adapter, created } = failingAdapter(409, conflict(code));
			const caught = await apiClient
				.post("/api/time/entries/start", {}, { adapter })
				.catch((error: unknown) => error);
			expect(caught).toBe(created.error);
		}
		expect(console.error).not.toHaveBeenCalled();
	});

	it("still logs other time conflicts", async () => {
		const { adapter } = failingAdapter(409, conflict("TIMESHEET_LOCKED"));
		await expect(
			apiClient.patch("/api/time/entries/e-1", {}, { adapter }),
		).rejects.toBeInstanceOf(AxiosError);
		expect(console.error).toHaveBeenCalledTimes(1);
	});

	it("still logs the same code outside /api/time", async () => {
		for (const url of ["/api/team-time/logs/start", "/api/roadmaps/r-1"]) {
			const { adapter } = failingAdapter(409, conflict("STALE_REVISION"));
			await expect(apiClient.post(url, {}, { adapter })).rejects.toBeInstanceOf(
				AxiosError,
			);
		}
		expect(console.error).toHaveBeenCalledTimes(2);
	});
});
