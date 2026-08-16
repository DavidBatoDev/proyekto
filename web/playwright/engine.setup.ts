import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Derives a storage state that pins the canvas to the in-house DOM+SVG engine.
 *
 * The engine resolver reads `localStorage["roadmap.canvasEngine"]` at module
 * init, so seeding that key is enough to run the ENTIRE existing canvas suite
 * against the other renderer with no spec changes at all. Playwright projects
 * cannot set localStorage directly, hence deriving a second storage state from
 * the authenticated one rather than adding an init script to every test.
 */

const AUTH_PATH = path.resolve(process.cwd(), "playwright", ".auth", "user.json");
const OUT_PATH = path.resolve(
	process.cwd(),
	"playwright",
	".auth",
	"user-domsvg.json",
);

const ENGINE_ENTRY = { name: "roadmap.canvasEngine", value: "dom-svg" };

test("derive dom-svg engine storage state", async () => {
	const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
	const origin = new URL(baseURL).origin;

	const state = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8")) as {
		cookies: unknown[];
		origins: Array<{
			origin: string;
			localStorage: Array<{ name: string; value: string }>;
		}>;
	};

	const existing = state.origins.find((entry) => entry.origin === origin);
	if (existing) {
		existing.localStorage = [
			...existing.localStorage.filter((item) => item.name !== ENGINE_ENTRY.name),
			ENGINE_ENTRY,
		];
	} else {
		state.origins.push({ origin, localStorage: [ENGINE_ENTRY] });
	}

	fs.writeFileSync(OUT_PATH, JSON.stringify(state, null, 2));
});
