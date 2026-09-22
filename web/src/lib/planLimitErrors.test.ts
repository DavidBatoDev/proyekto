import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isPlanLimitError,
	notifyPlanLimit,
	PlanLimitError,
	type PlanLimitInfo,
	parsePlanLimitBody,
	parsePlanLimitError,
	resetPlanLimitNotifications,
	setPlanLimitNotifier,
	toServiceError,
	wasPlanLimitJustNotified,
} from "./planLimitErrors";

/** What PlanLimitException carries, before HttpExceptionFilter wraps it. */
const payload = {
	code: "plan_limit",
	kind: "count",
	limit_key: "projects",
	label: "Projects",
	limit: 2,
	used: 2,
	plan: "free",
	upgrade_plan: "pro",
	workspace_id: "ws-1",
	workspace_slug: "acme",
	context: "create",
	message:
		"Your Free plan includes 2 projects and this workspace has 2. Upgrade to Pro to add more.",
};

const expected: PlanLimitInfo = {
	limitKey: "projects",
	kind: "count",
	label: "Projects",
	limit: 2,
	used: 2,
	plan: "free",
	upgradePlan: "pro",
	workspaceId: "ws-1",
	workspaceSlug: "acme",
	context: "create",
	message: payload.message,
};

/** The filter's envelope: `{ error: { ...payload, status, path } }`. */
const envelope = {
	error: { ...payload, status: 403, path: "/api/projects" },
};

const axiosError = (status: number, data: unknown) =>
	Object.assign(new Error(`Request failed with status code ${status}`), {
		isAxiosError: true,
		response: { status, data },
	});

afterEach(() => {
	resetPlanLimitNotifications();
});

describe("parsePlanLimitBody", () => {
	it("reads the HttpExceptionFilter envelope", () => {
		expect(parsePlanLimitBody(envelope, 403)).toEqual(expected);
	});

	it("reads the object-in-message form of a raw HttpException", () => {
		expect(
			parsePlanLimitBody({
				statusCode: 403,
				message: payload,
				error: "Forbidden",
			}),
		).toEqual(expected);
	});

	it("reads a flat body", () => {
		expect(parsePlanLimitBody(payload)).toEqual(expected);
	});

	it("reads a JSON string body, as a fetch text() would give", () => {
		expect(parsePlanLimitBody(JSON.stringify(envelope), 403)).toEqual(expected);
	});

	it("returns null for any status but 403", () => {
		expect(parsePlanLimitBody(envelope, 409)).toBeNull();
		expect(parsePlanLimitBody(envelope, 400)).toBeNull();
	});

	it("returns null for other codes and for missing keys", () => {
		expect(
			parsePlanLimitBody({
				error: { code: "missing_permission", message: "No" },
			}),
		).toBeNull();
		expect(parsePlanLimitBody({ error: { code: "plan_limit" } })).toBeNull();
		expect(parsePlanLimitBody(null)).toBeNull();
		expect(parsePlanLimitBody("not json")).toBeNull();
	});

	it("fills a feature gate's gaps from the catalogue", () => {
		const info = parsePlanLimitBody({
			error: {
				code: "plan_limit",
				limit_key: "change_requests",
				plan: "platinum",
				context: "sideways",
			},
		});
		expect(info).toEqual({
			limitKey: "change_requests",
			kind: "feature",
			label: "Change requests",
			limit: null,
			used: null,
			plan: "free",
			upgradePlan: null,
			workspaceId: null,
			workspaceSlug: null,
			context: null,
			message: "",
		});
	});
});

describe("parsePlanLimitError", () => {
	it("parses an axios error", () => {
		expect(parsePlanLimitError(axiosError(403, envelope))).toEqual(expected);
		expect(isPlanLimitError(axiosError(403, envelope))).toBe(true);
	});

	it("ignores a 409 and other 403s", () => {
		expect(parsePlanLimitError(axiosError(409, envelope))).toBeNull();
		expect(
			isPlanLimitError(
				axiosError(403, { error: { code: "missing_permission" } }),
			),
		).toBe(false);
		expect(parsePlanLimitError(new Error("boom"))).toBeNull();
		expect(parsePlanLimitError(undefined)).toBeNull();
	});

	it("walks .cause and .originalError", () => {
		const wrapped = new Error("Create epic failed: forbidden", {
			cause: axiosError(403, envelope),
		});
		expect(parsePlanLimitError(wrapped)).toEqual(expected);
		// RoadmapServiceError keeps the axios error as `originalError`.
		const roadmapError = Object.assign(new Error("Create epic failed"), {
			status: 403,
			originalError: axiosError(403, envelope),
		});
		expect(parsePlanLimitError(roadmapError)).toEqual(expected);
		expect(
			parsePlanLimitError(new Error("outer", { cause: roadmapError })),
		).toEqual(expected);
	});

	it("stops walking after four levels", () => {
		let err: unknown = axiosError(403, envelope);
		for (let i = 0; i < 4; i++) err = new Error(`wrap ${i}`, { cause: err });
		expect(parsePlanLimitError(err)).toEqual(expected);
		err = new Error("one too many", { cause: err });
		expect(parsePlanLimitError(err)).toBeNull();
	});

	it("handles a PlanLimitError instance", () => {
		const err = new PlanLimitError(expected);
		expect(parsePlanLimitError(err)).toBe(expected);
		expect(err.message).toBe(expected.message);
		expect(err.code).toBe("plan_limit");
		expect(err).toBeInstanceOf(Error);
	});

	it("gives a PlanLimitError readable text when the server sent none", () => {
		const err = new PlanLimitError({ ...expected, message: "" });
		expect(err.message).toMatch(/2-project limit of its Free plan/);
	});
});

describe("toServiceError", () => {
	it("keeps a plan limit's code through a service's catch block", () => {
		const original = axiosError(403, envelope);
		const err = toServiceError(original, "Could not create the team.");
		expect(err).toBeInstanceOf(PlanLimitError);
		expect((err as PlanLimitError).info).toEqual(expected);
		expect(err.cause).toBe(original);
		expect(isPlanLimitError(err)).toBe(true);
	});

	it("passes a PlanLimitError through untouched", () => {
		const err = new PlanLimitError(expected);
		expect(toServiceError(err, "fallback")).toBe(err);
	});

	it("uses the server's message for anything else", () => {
		const original = axiosError(400, {
			error: { message: "Team name is taken.", status: 400 },
		});
		const err = toServiceError(original, "Could not create the team.");
		expect(err).not.toBeInstanceOf(PlanLimitError);
		expect(err.message).toBe("Team name is taken.");
		expect(err.cause).toBe(original);
	});

	it("falls back when the server said nothing readable", () => {
		expect(
			toServiceError(new Error("Network Error"), "Try again.").message,
		).toBe("Try again.");
	});
});

describe("notifyPlanLimit", () => {
	it("is safe with no notifier registered", () => {
		expect(() => notifyPlanLimit(expected, 1000)).not.toThrow();
		expect(wasPlanLimitJustNotified(1100)).toBe(false);
	});

	it("dedupes the same workspace and limit within four seconds", () => {
		const notifier = vi.fn();
		setPlanLimitNotifier(notifier);
		notifyPlanLimit(expected, 10_000);
		notifyPlanLimit(expected, 12_000);
		notifyPlanLimit(expected, 13_999);
		expect(notifier).toHaveBeenCalledTimes(1);
		notifyPlanLimit(expected, 14_000);
		expect(notifier).toHaveBeenCalledTimes(2);
	});

	it("does not dedupe a different limit or workspace", () => {
		const notifier = vi.fn();
		setPlanLimitNotifier(notifier);
		notifyPlanLimit(expected, 10_000);
		notifyPlanLimit({ ...expected, limitKey: "teams" }, 10_001);
		notifyPlanLimit({ ...expected, workspaceId: "ws-2" }, 10_002);
		expect(notifier).toHaveBeenCalledTimes(3);
	});

	it("stops notifying once the notifier is cleared", () => {
		const notifier = vi.fn();
		setPlanLimitNotifier(notifier);
		setPlanLimitNotifier(null);
		notifyPlanLimit(expected, 10_000);
		expect(notifier).not.toHaveBeenCalled();
	});

	it("survives a notifier that throws", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		setPlanLimitNotifier(() => {
			throw new Error("toast exploded");
		});
		expect(() => notifyPlanLimit(expected, 10_000)).not.toThrow();
		spy.mockRestore();
	});
});

describe("wasPlanLimitJustNotified", () => {
	it("is true inside the window and expires after it", () => {
		setPlanLimitNotifier(vi.fn());
		expect(wasPlanLimitJustNotified(10_000)).toBe(false);
		notifyPlanLimit(expected, 10_000);
		expect(wasPlanLimitJustNotified(10_000)).toBe(true);
		expect(wasPlanLimitJustNotified(11_499)).toBe(true);
		expect(wasPlanLimitJustNotified(11_500)).toBe(false);
		expect(wasPlanLimitJustNotified(10_200, 100)).toBe(false);
	});

	it("is re-armed by a deduped repeat, whose error toast is also noise", () => {
		setPlanLimitNotifier(vi.fn());
		notifyPlanLimit(expected, 10_000);
		notifyPlanLimit(expected, 12_000);
		expect(wasPlanLimitJustNotified(13_000)).toBe(true);
	});
});
