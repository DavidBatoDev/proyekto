import { describe, expect, it } from "vitest";
import { detectProvider } from "./providers";

describe("detectProvider", () => {
	it("recognizes each provider by URL host", () => {
		expect(detectProvider("https://meet.google.com/abc-defg-hij")).toBe(
			"google_meet",
		);
		expect(detectProvider("https://us05web.zoom.us/j/123456789")).toBe("zoom");
		expect(
			detectProvider("https://teams.microsoft.com/l/meetup-join/xyz"),
		).toBe("teams");
		expect(detectProvider("https://meet.jit.si/proyekto-abc")).toBe("jitsi");
	});

	it("falls back to 'other' for unknown or empty urls", () => {
		expect(detectProvider("https://example.com/call")).toBe("other");
		expect(detectProvider("")).toBe("other");
		expect(detectProvider(null)).toBe("other");
		expect(detectProvider(undefined)).toBe("other");
	});

	it("tolerates non-URL strings", () => {
		expect(detectProvider("meet.google.com/abc")).toBe("google_meet");
	});
});
