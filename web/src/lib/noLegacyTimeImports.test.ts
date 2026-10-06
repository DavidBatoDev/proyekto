import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard for the time rebuild's cleanup (W3-1).
 *
 * The old per-log time code is gone: `services/team-time.service.ts` (the
 * client of the old team-time API), the old
 * `components/team-time/useActiveTimer.ts` and every query key in the old
 * team-time cache namespace. New code talks to `/api/time` through
 * `services/time.service.ts`, keys its queries under `["time", …]`
 * (`queries/time.ts`) and runs the timer through
 * `components/time/timer/useActiveTimer.ts`. One convenient import would
 * bring the old cache back beside the new one, so this test walks every file
 * under `web/src`, tests included, and fails on:
 *
 * - any import, re-export, dynamic import, `vi.mock`, `vi.importActual` or
 *   `require` of the two retired modules, by alias or relative path;
 * - the old namespace as a quoted string anywhere: a key head, a namespace
 *   constant, a predicate or a later key element;
 * - a call to the old API's path outside `api/axios.ts`, which keeps the
 *   alias's 403 silence for older app bundles (and its test).
 *
 * What stays in `components/team-time/` (rates, payouts, the period filter,
 * the row menu, the switch) is live and allowed. The walk skips this file
 * (`SELF`), but it builds the namespace from parts and so passes its own
 * checks; the last walk test pins that.
 */

const SRC = resolve(__dirname, "..");
const SELF = resolve(__filename);

/** The old namespace, built from parts so this file never spells it. */
const NAMESPACE = ["team", "time"].join("-");

/** The retired modules, as extension-less paths relative to `web/src`. */
const RETIRED = [
	`services/${NAMESPACE}.service`,
	`components/${NAMESPACE}/useActiveTimer`,
];

/** A key that starts with the old namespace, however it is spaced or quoted. */
const TEAM_TIME_KEY = new RegExp(`\\[\\s*["'\`]${NAMESPACE}["'\`]`);

/**
 * The old namespace as a whole quoted string anywhere: a namespace constant
 * (`const NS = …; [NS, id]`), a predicate (`q.queryKey[0] === …`) or a later
 * key element (`[...base, …]`). Path strings such as the live
 * `components/<namespace>/…` imports are not whole strings, so they pass.
 */
const TEAM_TIME_STRING = new RegExp(`["'\`]${NAMESPACE}["'\`]`);

/** Files allowed to hold that string, relative to `web/src`. */
const STRING_ALLOWED = [
	// Asserts the new key tree never contains the old namespace.
	"queries/time.test.ts",
];

/** The old API's path, however it is joined (`/api/…`, `${base}api/…`). */
const TEAM_TIME_API = new RegExp(`\\bapi/${NAMESPACE}\\b`);

/** Files allowed to name the old API, relative to `web/src`. */
const API_ALLOWED = [
	// Keeps the alias's 403 silence for older app bundles.
	"api/axios.ts",
	"api/axios.test.ts",
];

/**
 * Every module specifier: `from "x"`, `import "x"`, `import("x")` (also with
 * a leading comment such as `@vite-ignore`), `vi.mock("x")`,
 * `vi.importActual("x")` / `vi.importMock("x")` (with or without a type
 * argument) and `require("x")`. `import.meta.glob` and `new URL(…)` are not
 * read; a retired module can't load through them anyway, because the
 * "keeps the retired modules deleted" check below holds.
 */
const SPECIFIER =
	/(?:\bfrom\s*|\bimport\s*\(?\s*(?:\/\*[\s\S]*?\*\/\s*)*|\bvi\.(?:do)?(?:mock|unmock)\s*\(\s*|\bvi\.import(?:Actual|Mock)\s*(?:<[^>]*>)?\s*\(\s*|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;

function sourceFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			found.push(...sourceFiles(full));
			continue;
		}
		if (/\.(?:ts|tsx|mts|cts|js|jsx|mjs)$/.test(entry)) found.push(full);
	}
	return found;
}

const toPosix = (path: string) => path.split(sep).join("/");

/** The specifier as a path relative to `web/src` with no extension, or null for a package. */
function resolveSpecifier(file: string, raw: string): string | null {
	// Vite query suffixes (`?raw`, `?url`) and hashes don't change the module.
	const spec = raw.replace(/[?#].*$/, "");
	let absolute: string;
	if (spec.startsWith("@/")) absolute = join(SRC, spec.slice(2));
	else if (spec.startsWith(".")) absolute = resolve(dirname(file), spec);
	else return null;
	return toPosix(relative(SRC, absolute)).replace(
		/(?:\/index)?\.(?:ts|tsx|js|jsx)$/,
		"",
	);
}

/** The retired modules a file's source pulls in. */
function retiredImports(file: string, text: string): string[] {
	const hits: string[] = [];
	for (const match of text.matchAll(SPECIFIER)) {
		const target = resolveSpecifier(file, match[1]);
		if (target && RETIRED.includes(target)) hits.push(target);
	}
	return hits;
}

describe("no legacy team-time imports or keys", () => {
	const files = sourceFiles(SRC).filter((file) => resolve(file) !== SELF);

	it("walks the whole source tree", () => {
		// Guards the guard: a broken walk would make every check below pass.
		expect(files.length).toBeGreaterThan(500);
		const names = files.map((file) => toPosix(relative(SRC, file)));
		expect(names).toContain("services/time.service.ts");
		expect(names).toContain("components/time/timer/useActiveTimer.ts");
	});

	it("keeps the retired modules deleted", () => {
		for (const path of RETIRED) {
			expect(existsSync(join(SRC, `${path}.ts`))).toBe(false);
			expect(existsSync(join(SRC, `${path}.tsx`))).toBe(false);
		}
	});

	it("imports neither services/team-time.service nor the old useActiveTimer", () => {
		const offenders = files.flatMap((file) =>
			retiredImports(file, readFileSync(file, "utf8")).map(
				(target) => `${toPosix(relative(SRC, file))} -> ${target}`,
			),
		);
		expect(offenders).toEqual([]);
	});

	it("never keys a query under the old namespace", () => {
		const offenders = files
			.filter((file) => TEAM_TIME_KEY.test(readFileSync(file, "utf8")))
			.map((file) => toPosix(relative(SRC, file)));
		expect(offenders).toEqual([]);
	});

	it("never spells the old namespace as a whole string", () => {
		const offenders = files
			.map((file) => toPosix(relative(SRC, file)))
			.filter((name) => !STRING_ALLOWED.includes(name))
			.filter((name) =>
				TEAM_TIME_STRING.test(readFileSync(join(SRC, name), "utf8")),
			);
		expect(offenders).toEqual([]);
	});

	it("calls the old API only from the axios alias rules", () => {
		const offenders = files
			.map((file) => toPosix(relative(SRC, file)))
			.filter((name) => !API_ALLOWED.includes(name))
			.filter((name) =>
				TEAM_TIME_API.test(readFileSync(join(SRC, name), "utf8")),
			);
		expect(offenders).toEqual([]);
	});

	it("keeps its allowlists pointing at real files", () => {
		for (const name of [...STRING_ALLOWED, ...API_ALLOWED]) {
			expect(existsSync(join(SRC, name))).toBe(true);
		}
	});

	it("passes its own checks, although the walk skips it", () => {
		const own = readFileSync(SELF, "utf8");
		expect(retiredImports(SELF, own)).toEqual([]);
		expect(TEAM_TIME_KEY.test(own)).toBe(false);
		expect(TEAM_TIME_STRING.test(own)).toBe(false);
		expect(TEAM_TIME_API.test(own)).toBe(false);
	});
});

describe("the guard's matchers", () => {
	const file = join(SRC, "components", "time", "page", "Example.tsx");
	const legacyFile = join(SRC, "components", NAMESPACE, "Example.tsx");
	const service = `@/services/${NAMESPACE}.service`;
	const oldTimer = `@/components/${NAMESPACE}/useActiveTimer`;

	it("catches alias, relative, type-only, dynamic and mocked imports", () => {
		expect(retiredImports(file, `import { a } from "${service}";`)).toEqual([
			RETIRED[0],
		]);
		expect(
			retiredImports(file, `import type { T } from '${service}';`),
		).toEqual([RETIRED[0]]);
		expect(retiredImports(file, `export * from "${oldTimer}";`)).toEqual([
			RETIRED[1],
		]);
		expect(retiredImports(file, `await import("${oldTimer}")`)).toEqual([
			RETIRED[1],
		]);
		expect(retiredImports(file, `vi.mock("${service}", () => ({}));`)).toEqual([
			RETIRED[0],
		]);
		expect(
			retiredImports(
				file,
				`import x from "../../../services/${NAMESPACE}.service";`,
			),
		).toEqual([RETIRED[0]]);
		expect(
			retiredImports(
				legacyFile,
				`import { useActiveTimer } from "./useActiveTimer";`,
			),
		).toEqual([RETIRED[1]]);
	});

	it("catches importActual, importMock, commented dynamic imports and query suffixes", () => {
		expect(
			retiredImports(file, `await vi.importActual("${service}");`),
		).toEqual([RETIRED[0]]);
		expect(
			retiredImports(
				file,
				`await vi.importActual<typeof import("${service}")>("${service}");`,
			),
		).toEqual([RETIRED[0]]);
		expect(retiredImports(file, `await vi.importMock('${oldTimer}');`)).toEqual(
			[RETIRED[1]],
		);
		expect(
			retiredImports(file, `await import(/* @vite-ignore */ "${oldTimer}")`),
		).toEqual([RETIRED[1]]);
		expect(retiredImports(file, `import src from "${service}?raw";`)).toEqual([
			RETIRED[0],
		]);
		expect(
			retiredImports(file, `import u from "@/services/time.service?url";`),
		).toEqual([]);
	});

	it("lets the new timer and the live legacy files through", () => {
		expect(
			retiredImports(
				file,
				`import { useActiveTimer } from "../timer/useActiveTimer";`,
			),
		).toEqual([]);
		expect(
			retiredImports(
				file,
				`import { RowActionsMenu } from "@/components/team-time/RowActionsMenu";`,
			),
		).toEqual([]);
		expect(
			retiredImports(
				file,
				`import { timeService } from "@/services/time.service";`,
			),
		).toEqual([]);
	});

	it("spots the key literal, however it is spaced or quoted", () => {
		const key = NAMESPACE;
		expect(TEAM_TIME_KEY.test(`queryKey: ["${key}", teamId]`)).toBe(true);
		expect(TEAM_TIME_KEY.test(`queryKey: [\n\t'${key}',\n]`)).toBe(true);
		expect(TEAM_TIME_KEY.test(`queryKey: ["time", "me"]`)).toBe(false);
		expect(TEAM_TIME_KEY.test(`"/api/${key}/teams/"`)).toBe(false);
	});

	it("spots the namespace as a whole string, wherever it sits", () => {
		const key = NAMESPACE;
		// A namespace constant, a predicate and a later key element.
		expect(TEAM_TIME_STRING.test(`const NS = "${key}"; [NS, id]`)).toBe(true);
		expect(
			TEAM_TIME_STRING.test(`predicate: (q) => q.queryKey[0] === '${key}'`),
		).toBe(true);
		expect(TEAM_TIME_STRING.test("[...base, `" + key + "`]")).toBe(true);
		// Strings that merely contain it are fine.
		expect(
			TEAM_TIME_STRING.test(`from "@/components/${key}/RowActionsMenu"`),
		).toBe(false);
		expect(TEAM_TIME_STRING.test(`"/api/${key}/teams/"`)).toBe(false);
		expect(TEAM_TIME_STRING.test(`"${key}-legacy"`)).toBe(false);
	});

	it("spots a call to the old API, however the path is joined", () => {
		const key = NAMESPACE;
		expect(TEAM_TIME_API.test(`apiClient.get("/api/${key}/logs")`)).toBe(true);
		expect(TEAM_TIME_API.test("`${base}api/" + key + "/teams/${id}`")).toBe(
			true,
		);
		expect(TEAM_TIME_API.test(`apiClient.get("/api/time/me/running")`)).toBe(
			false,
		);
		expect(TEAM_TIME_API.test(`"/api/${key}s"`)).toBe(false);
	});
});
