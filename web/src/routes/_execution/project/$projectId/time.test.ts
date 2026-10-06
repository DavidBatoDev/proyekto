/* @vitest-environment jsdom */

/**
 * Project › Time's redirect map (ux.md › Routes and Redirects):
 *
 * | Old                                   | New                          |
 * |---------------------------------------|------------------------------|
 * | `/project/:p/time?view=team`          | `?view=everyone`             |
 * | `/project/:p/time?view=mine`          | `/time?project=<p>`          |
 *
 * (Someone who only logs here and asks for no view is sent to
 * `/time?project=` by the page once their permissions load; that case is in
 * `components/project/time/ProjectTimePage.test.tsx`.)
 */

import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isAuthenticated: true }));
vi.mock("@/stores/authStore", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/stores/authStore")>();
	return {
		...actual,
		useAuthStore: Object.assign(() => auth, { getState: () => auth }),
		useUser: () => ({ id: "me" }),
	};
});

import { Route } from "./time";

const PROJECT = "22222222-2222-4222-8222-222222222222";
const PERSON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type RedirectOptions = {
	to?: string;
	params?: unknown;
	search?: unknown;
	replace?: boolean;
};

function load(
	search: Record<string, unknown>,
	projectId = PROJECT,
): Promise<unknown> {
	const validate = Route.options.validateSearch as (
		raw: Record<string, unknown>,
	) => Record<string, unknown>;
	const beforeLoad = Route.options.beforeLoad as unknown as (args: {
		params: Record<string, string>;
		search: Record<string, unknown>;
		location: { href: string };
	}) => unknown;
	return Promise.resolve().then(() =>
		beforeLoad({
			params: { projectId },
			search: validate(search),
			location: { href: `/project/${projectId}/time` },
		}),
	);
}

async function redirectOf(promise: Promise<unknown>): Promise<RedirectOptions> {
	try {
		await promise;
	} catch (err) {
		if (isRedirect(err)) return (err as { options: RedirectOptions }).options;
		throw err;
	}
	throw new Error("expected a redirect");
}

beforeEach(() => {
	auth.isAuthenticated = true;
});

describe("/project/:p/time redirects", () => {
	it("sends ?view=team to ?view=everyone, keeping the filters", async () => {
		expect(
			await redirectOf(
				load({ view: "team", person: PERSON, from: "2026-09-01" }),
			),
		).toMatchObject({
			to: "/project/$projectId/time",
			params: { projectId: PROJECT },
			search: { view: "everyone", person: PERSON, from: "2026-09-01" },
			replace: true,
		});
	});

	it("sends ?view=mine to the caller's own time on this project", async () => {
		expect(await redirectOf(load({ view: "mine" }))).toMatchObject({
			to: "/time",
			search: { project: PROJECT },
			replace: true,
		});
	});

	it("drops old period params instead of failing", async () => {
		await expect(
			load({ preset: "this_week", from: "2026-09-01T00:00:00.000Z" }),
		).resolves.toBeUndefined();
	});

	it("leaves the current views alone", async () => {
		await expect(load({})).resolves.toBeUndefined();
		await expect(load({ view: "everyone" })).resolves.toBeUndefined();
		await expect(load({ view: "client" })).resolves.toBeUndefined();
	});

	it("sends a signed-out visitor to log in, keeping the link", async () => {
		auth.isAuthenticated = false;
		expect(await redirectOf(load({ view: "team" }))).toMatchObject({
			to: "/auth/login",
			search: { redirect: `/project/${PROJECT}/time` },
		});
	});
});
