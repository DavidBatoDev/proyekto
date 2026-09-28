import { afterEach, describe, expect, it, vi } from "vitest";

// The offset is module state, so each test gets a fresh copy.
async function freshClock() {
	vi.resetModules();
	return import("./serverClock");
}

afterEach(() => {
	vi.useRealTimers();
});

describe("serverClock", () => {
	it("corrects a device clock running a minute slow", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.parse("2026-09-28T06:45:27.000Z"));
		const { recordServerDate, serverNow } = await freshClock();

		const sentAt = Date.now();
		recordServerDate("Mon, 28 Sep 2026 06:46:34 GMT", sentAt, sentAt + 200);

		// Server 06:46:34.5 (midpoint of the truncated second) vs device 06:45:27.1.
		expect(serverNow() - Date.now()).toBe(67_400);
	});

	it("ignores offsets inside the header's one-second resolution", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.parse("2026-09-28T06:45:27.300Z"));
		const { recordServerDate, serverNow } = await freshClock();

		recordServerDate("Mon, 28 Sep 2026 06:45:27 GMT", Date.now(), Date.now());

		expect(serverNow()).toBe(Date.now());
	});

	it("does not let small jitter move an established offset", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.parse("2026-09-28T06:45:27.000Z"));
		const { recordServerDate, serverNow } = await freshClock();

		recordServerDate("Mon, 28 Sep 2026 06:46:34 GMT", Date.now(), Date.now());
		const first = serverNow() - Date.now();
		recordServerDate("Mon, 28 Sep 2026 06:46:35 GMT", Date.now(), Date.now());

		expect(serverNow() - Date.now()).toBe(first);
	});

	it("skips missing or malformed headers", async () => {
		const { recordServerDate, serverNow } = await freshClock();
		recordServerDate(undefined, 0, 0);
		recordServerDate("not a date", 0, 0);
		const before = Date.now();
		expect(Math.abs(serverNow() - before)).toBeLessThan(50);
	});
});
