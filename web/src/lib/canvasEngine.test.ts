import { describe, expect, it } from "vitest";
import { resolveCanvasEngineFrom } from "./canvasEngine";

/**
 * The precedence chain is the whole point of this module, and getting it wrong
 * is either a canvas that cannot be overridden (no kill switch) or one that
 * activates the new engine when nobody asked.
 */
describe("resolveCanvasEngineFrom", () => {
	const env = "react-flow" as const;

	it("falls back to the build-time flag when nothing overrides it", () => {
		expect(
			resolveCanvasEngineFrom({ url: null, stored: null, surface: null, env }),
		).toEqual({ engine: "react-flow", source: "env" });
	});

	it("prefers the URL param over everything", () => {
		expect(
			resolveCanvasEngineFrom({
				url: "dom-svg",
				stored: "react-flow",
				surface: "react-flow",
				env,
			}),
		).toEqual({ engine: "dom-svg", source: "url" });
	});

	it("prefers stored over the per-surface constant", () => {
		// This is what lets support hand a user ?canvas=react-flow on ANY surface,
		// including one the ramp has already flipped, with no deploy.
		expect(
			resolveCanvasEngineFrom({
				url: null,
				stored: "react-flow",
				surface: "dom-svg",
				env,
			}),
		).toEqual({ engine: "react-flow", source: "storage" });
	});

	it("uses the per-surface constant when there is no user override", () => {
		expect(
			resolveCanvasEngineFrom({
				url: null,
				stored: null,
				surface: "dom-svg",
				env,
			}),
		).toEqual({ engine: "dom-svg", source: "surface" });
	});

	it("reports provenance so a failure can name where the engine came from", () => {
		const sources = [
			resolveCanvasEngineFrom({
				url: "dom-svg",
				stored: null,
				surface: null,
				env,
			}).source,
			resolveCanvasEngineFrom({
				url: null,
				stored: "dom-svg",
				surface: null,
				env,
			}).source,
			resolveCanvasEngineFrom({
				url: null,
				stored: null,
				surface: "dom-svg",
				env,
			}).source,
			resolveCanvasEngineFrom({ url: null, stored: null, surface: null, env })
				.source,
		];

		expect(sources).toEqual(["url", "storage", "surface", "env"]);
	});
});
