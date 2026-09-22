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

	it("never treats another status as a plan limit", async () => {
		const { adapter } = failingAdapter(409, planLimitBody);

		await expect(
			apiClient.post("/api/teams", {}, { adapter }),
		).rejects.toBeInstanceOf(AxiosError);
		expect(notifier).not.toHaveBeenCalled();
	});
});
