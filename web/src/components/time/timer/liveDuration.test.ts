/* @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	bankedBreakSeconds,
	formatBreak,
	formatClock,
	formatHoursMinutes,
	liveBreakSeconds,
	liveTickSubscriberCount,
	liveWorkSeconds,
	useLiveNowMs,
} from "./liveDuration";

const T0 = Date.parse("2026-10-06T09:00:00.000Z");
const at = (seconds: number) => T0 + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString();

const running = (over: Record<string, unknown> = {}) => ({
	started_at: iso(0),
	ended_at: null,
	paused_at: null,
	duration_seconds: null,
	break_seconds: 0,
	break_minutes: 0,
	...over,
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("live clocks", () => {
	it("counts worked seconds from the start, net of banked breaks", () => {
		expect(liveWorkSeconds(running(), at(3600))).toBe(3600);
		expect(liveWorkSeconds(running({ break_seconds: 600 }), at(3600))).toBe(
			3000,
		);
	});

	it("freezes the work clock at paused_at and counts the break live", () => {
		const paused = running({ paused_at: iso(1800), break_seconds: 60 });
		expect(liveWorkSeconds(paused, at(3600))).toBe(1740);
		expect(liveWorkSeconds(paused, at(7200))).toBe(1740);
		expect(liveBreakSeconds(paused, at(3600))).toBe(60 + 1800);
	});

	it("reads a finished entry's stored duration", () => {
		const done = running({ ended_at: iso(100), duration_seconds: 95 });
		expect(liveWorkSeconds(done, at(9999))).toBe(95);
		expect(liveBreakSeconds({ ...done, paused_at: iso(50) }, at(9999))).toBe(0);
	});

	it("never goes negative (a device clock behind the server)", () => {
		expect(liveWorkSeconds(running(), at(-30))).toBe(0);
	});

	it("falls back to break_minutes when break_seconds is missing", () => {
		expect(bankedBreakSeconds({ break_minutes: 2 })).toBe(120);
		expect(bankedBreakSeconds({ break_seconds: Number.NaN })).toBe(0);
	});

	it("tolerates an unparseable start", () => {
		expect(
			liveWorkSeconds(
				running({ started_at: "nope", duration_seconds: 7 }),
				at(1),
			),
		).toBe(7);
	});
});

describe("formats", () => {
	it("formats the running clock, h:mm and a break countdown", () => {
		expect(formatClock(4364)).toBe("01:12:44");
		expect(formatClock(-5)).toBe("00:00:00");
		expect(formatHoursMinutes(4364)).toBe("1:12");
		expect(formatHoursMinutes(36 * 3600 + 5 * 60)).toBe("36:05");
		expect(formatBreak(330)).toBe("05:30");
	});
});

describe("useLiveNowMs", () => {
	it("shares one tick and stops it when the last listener leaves", () => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
		const a = renderHook(() => useLiveNowMs(true));
		const b = renderHook(() => useLiveNowMs(true));
		expect(liveTickSubscriberCount()).toBe(2);
		act(() => {
			vi.advanceTimersByTime(3000);
		});
		expect(a.result.current).toBeGreaterThanOrEqual(T0 + 3000);
		expect(b.result.current).toBe(a.result.current);
		a.unmount();
		b.unmount();
		expect(liveTickSubscriberCount()).toBe(0);
	});

	it("does not subscribe while inactive", () => {
		const { result } = renderHook(() => useLiveNowMs(false));
		expect(liveTickSubscriberCount()).toBe(0);
		expect(typeof result.current).toBe("number");
	});
});
