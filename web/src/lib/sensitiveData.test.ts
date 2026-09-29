import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ native: false }));

vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native }));

import { canHandleSensitiveData } from "./sensitiveData";

afterEach(() => {
	mocks.native = false;
});

describe("canHandleSensitiveData", () => {
	it("allows payout details and identity documents on the web", () => {
		expect(canHandleSensitiveData()).toBe(true);
	});

	it("keeps them out of the installed app", () => {
		mocks.native = true;
		expect(canHandleSensitiveData()).toBe(false);
	});
});
