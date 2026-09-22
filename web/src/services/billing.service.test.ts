import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanLimitError } from "@/lib/planLimitErrors";

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("@/api/axios", () => ({ default: client }));

import {
	createCheckoutSession,
	createPortalSession,
	getBillingSummary,
} from "./billing.service";

/** What the axios client rejects with once the filter has shaped the body. */
function httpError(status: number, error: Record<string, unknown>) {
	return Object.assign(new Error(`Request failed with status code ${status}`), {
		response: { status, data: { error: { ...error, status } } },
	});
}

beforeEach(() => {
	client.get.mockReset();
	client.post.mockReset();
});

describe("billing.service errors", () => {
	// These used to hand the whole axios error to extractApiErrorMessage, which
	// reads a response BODY — so every failure collapsed to the fallback and
	// the server's reason never reached the page.
	it("getBillingSummary surfaces the server's message", async () => {
		client.get.mockRejectedValue(
			httpError(403, { message: "Only owners and admins can see billing." }),
		);

		await expect(getBillingSummary("ws-1")).rejects.toThrow(
			"Only owners and admins can see billing.",
		);
	});

	it("createCheckoutSession surfaces a complimentary workspace's refusal", async () => {
		client.post.mockRejectedValue(
			httpError(409, {
				code: "workspace_complimentary",
				message: "This workspace's plan is complimentary.",
			}),
		);

		await expect(
			createCheckoutSession("ws-1", { plan: "pro", interval: "month" }),
		).rejects.toThrow("This workspace's plan is complimentary.");
	});

	it("createPortalSession surfaces the server's message", async () => {
		client.post.mockRejectedValue(
			httpError(400, { message: "No billing account yet." }),
		);

		await expect(createPortalSession("ws-1")).rejects.toThrow(
			"No billing account yet.",
		);
	});

	it("falls back to its own wording when the server sent nothing readable", async () => {
		client.get.mockRejectedValue(new Error("Network Error"));

		await expect(getBillingSummary("ws-1")).rejects.toThrow(
			"Failed to load billing details.",
		);
	});

	it("keeps a plan-limit refusal's code", async () => {
		client.post.mockRejectedValue(
			httpError(403, {
				code: "plan_limit",
				kind: "count",
				limit_key: "members",
				limit: 10,
				used: 10,
				plan: "free",
				upgrade_plan: "pro",
				workspace_id: "ws-1",
				message: "Acme has reached the 10-member limit of its Free plan.",
			}),
		);

		const caught = await createPortalSession("ws-1").catch(
			(error: unknown) => error,
		);
		expect(caught).toBeInstanceOf(PlanLimitError);
		expect((caught as PlanLimitError).info.limitKey).toBe("members");
	});
});
