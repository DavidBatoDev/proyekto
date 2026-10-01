import { describe, expect, it } from "vitest";
import {
	ApiError,
	apiErrorFrom,
	httpStatusOf,
	isAccessDeniedError,
	retryUnlessAccessDenied,
} from "./apiErrors";

const axiosError = (status: number, data?: unknown) =>
	Object.assign(new Error(`Request failed with status code ${status}`), {
		response: { status, data },
	});

describe("httpStatusOf", () => {
	it("reads an axios response status", () => {
		expect(httpStatusOf(axiosError(403))).toBe(403);
	});

	it("reads a status stamped on the error itself", () => {
		expect(httpStatusOf(new ApiError("nope", 404))).toBe(404);
		expect(httpStatusOf(Object.assign(new Error("x"), { status: 401 }))).toBe(
			401,
		);
	});

	it("is null for errors without a status", () => {
		expect(httpStatusOf(new Error("network down"))).toBeNull();
		expect(httpStatusOf(null)).toBeNull();
		expect(httpStatusOf("boom")).toBeNull();
	});
});

describe("isAccessDeniedError", () => {
	it.each([401, 403, 404])("treats %i as a refusal", (status) => {
		expect(isAccessDeniedError(axiosError(status))).toBe(true);
	});

	it.each([400, 409, 500, 503])("does not treat %i as a refusal", (status) => {
		expect(isAccessDeniedError(axiosError(status))).toBe(false);
	});

	it("does not treat a status-less failure as a refusal", () => {
		expect(isAccessDeniedError(new Error("timeout"))).toBe(false);
	});
});

describe("apiErrorFrom", () => {
	it("keeps the status and the server's message", () => {
		const error = apiErrorFrom(
			axiosError(403, {
				message: {
					code: "missing_permission",
					message: "You need finance.view",
					path: "finance.view",
				},
			}),
			"Failed to load",
		);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toBeInstanceOf(Error);
		expect(error.status).toBe(403);
		expect(isAccessDeniedError(error)).toBe(true);
		expect(error.message).toMatch(/finance/i);
	});

	it("falls back to the given message with no body", () => {
		const error = apiErrorFrom(new Error("Network Error"), "Failed to load");
		expect(error.message).toBe("Failed to load");
		expect(error.status).toBeNull();
	});
});

describe("retryUnlessAccessDenied", () => {
	it("never retries a refusal", () => {
		const retry = retryUnlessAccessDenied();
		for (const status of [401, 403, 404]) {
			expect(retry(0, axiosError(status))).toBe(false);
			expect(retry(0, new ApiError("no", status))).toBe(false);
		}
	});

	it("retries other failures up to the limit", () => {
		const retry = retryUnlessAccessDenied(2);
		const failure = axiosError(500);
		expect(retry(0, failure)).toBe(true);
		expect(retry(1, failure)).toBe(true);
		expect(retry(2, failure)).toBe(false);
	});
});
