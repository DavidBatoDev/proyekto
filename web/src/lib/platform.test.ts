import { beforeEach, describe, expect, it, vi } from "vitest";

const capacitor = vi.hoisted(() => ({ isNativePlatform: vi.fn(() => false) }));
vi.mock("@capacitor/core", () => ({ Capacitor: capacitor }));

import { isNativeApp } from "./platform";

beforeEach(() => {
	capacitor.isNativePlatform.mockReset();
});

describe("isNativeApp", () => {
	it("is false in a browser", () => {
		capacitor.isNativePlatform.mockReturnValue(false);
		expect(isNativeApp()).toBe(false);
	});

	it("is true inside the installed shell", () => {
		capacitor.isNativePlatform.mockReturnValue(true);
		expect(isNativeApp()).toBe(true);
	});

	it("reads the value live rather than caching the first answer", () => {
		capacitor.isNativePlatform.mockReturnValue(false);
		expect(isNativeApp()).toBe(false);
		capacitor.isNativePlatform.mockReturnValue(true);
		expect(isNativeApp()).toBe(true);
	});
});
