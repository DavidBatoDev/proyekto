import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const put = vi.fn();
const post = vi.fn();

vi.mock("@/api", () => ({
	apiClient: {
		get: (...args: unknown[]) => get(...args),
		put: (...args: unknown[]) => put(...args),
		post: (...args: unknown[]) => post(...args),
	},
}));

const {
	fetchMyMarketplaceSurvey,
	saveMarketplaceSurvey,
	skipMarketplaceSurvey,
} = await import("./marketplaceSurvey");

const ROW = {
	status: "completed",
	intents: ["client"],
	categories: [],
	talent_goal: null,
	company_size: null,
	completed_at: "2026-08-19T00:00:00Z",
	updated_at: "2026-08-19T00:00:00Z",
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("fetchMyMarketplaceSurvey", () => {
	/**
	 * The regression this file exists for. The backend's ResponseInterceptor
	 * wraps every response as `{ data }`, and a user who has never been asked
	 * gets `{ data: null }`. Written the usual way — `body.data ?? body` — `??`
	 * falls through on that null and returns the ENVELOPE, which is truthy, so
	 * the modal decides the survey is already answered and never opens. It
	 * typechecks, it lints, and it only fails in a browser.
	 */
	it("returns null for an unanswered survey rather than the envelope object", async () => {
		get.mockResolvedValue({ data: { data: null } });
		await expect(fetchMyMarketplaceSurvey()).resolves.toBeNull();
	});

	it("unwraps an answered survey", async () => {
		get.mockResolvedValue({ data: { data: ROW } });
		await expect(fetchMyMarketplaceSurvey()).resolves.toEqual(ROW);
	});

	it("tolerates an un-enveloped body, in case the route ever opts out", async () => {
		get.mockResolvedValue({ data: ROW });
		await expect(fetchMyMarketplaceSurvey()).resolves.toEqual(ROW);
	});

	it("returns null for an empty body instead of undefined", async () => {
		get.mockResolvedValue({ data: null });
		await expect(fetchMyMarketplaceSurvey()).resolves.toBeNull();
	});
});

describe("writes", () => {
	it("saves to the mine route and unwraps the row", async () => {
		put.mockResolvedValue({ data: { data: ROW } });
		await expect(
			saveMarketplaceSurvey({ intents: ["client"], status: "completed" }),
		).resolves.toEqual(ROW);
		expect(put).toHaveBeenCalledWith("/api/marketplace/survey/mine", {
			intents: ["client"],
			status: "completed",
		});
	});

	it("skips through its own route, not through a status on save", async () => {
		post.mockResolvedValue({ data: { data: { ...ROW, status: "skipped" } } });
		await expect(skipMarketplaceSurvey()).resolves.toMatchObject({
			status: "skipped",
		});
		expect(post).toHaveBeenCalledWith("/api/marketplace/survey/skip", {});
	});
});
