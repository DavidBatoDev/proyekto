import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
	supabase: {
		auth: {
			getSession: vi.fn(async () => ({
				data: { session: { access_token: "token" } },
			})),
		},
	},
}));

import { ApiError, httpStatusOf, isAccessDeniedError } from "@/lib/apiErrors";
import { projectService } from "./project.service";

function answer(status: number, body: unknown, json = true) {
	return vi.fn(
		async () =>
			new Response(json ? JSON.stringify(body) : String(body), {
				status,
				headers: { "Content-Type": json ? "application/json" : "text/html" },
			}),
	);
}

beforeEach(() => {
	vi.stubEnv("VITE_API_URL", "http://api.test");
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("projectService.getMyPermissions", () => {
	it("keeps the status of a refusal, so pages can tell 'not yours' from 'failed'", async () => {
		vi.stubGlobal(
			"fetch",
			answer(403, { message: "You do not have access to this project" }),
		);
		const error = await projectService.getMyPermissions("p1").catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(httpStatusOf(error)).toBe(403);
		expect(isAccessDeniedError(error)).toBe(true);
		expect((error as Error).message).toBe(
			"You do not have access to this project",
		);
	});

	it("keeps the status when the error body isn't JSON", async () => {
		vi.stubGlobal("fetch", answer(502, "<html>Bad gateway</html>", false));
		const error = await projectService.getMyPermissions("p1").catch((e) => e);
		expect(httpStatusOf(error)).toBe(502);
		expect(isAccessDeniedError(error)).toBe(false);
		expect((error as Error).message).toBe("Failed to fetch your permissions");
	});

	it("returns the permissions on success", async () => {
		vi.stubGlobal("fetch", answer(200, { data: { access: { time: true } } }));
		await expect(projectService.getMyPermissions("p1")).resolves.toEqual({
			access: { time: true },
		});
	});
});
