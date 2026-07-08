import { describe, expect, it } from "vitest";
import {
	diffMinutes,
	formatTime12h,
	parseTimeInput,
	timeOptions,
	timeZoneOffsetLabel,
	utcToZonedParts,
	wallTimeToUtcISO,
} from "./datetime";

describe("wallTimeToUtcISO", () => {
	it("interprets the wall-clock in the given zone, not the browser's", () => {
		// 4:00pm in Manila (UTC+8, no DST) is 08:00Z.
		expect(wallTimeToUtcISO("2026-07-08", "16:00", "Asia/Manila")).toBe(
			"2026-07-08T08:00:00.000Z",
		);
	});

	it("honors DST for the meeting's own date", () => {
		// New York observes DST in July (UTC-4): 9:00am → 13:00Z.
		expect(wallTimeToUtcISO("2026-07-08", "09:00", "America/New_York")).toBe(
			"2026-07-08T13:00:00.000Z",
		);
		// ...but in January (UTC-5): 9:00am → 14:00Z.
		expect(wallTimeToUtcISO("2026-01-08", "09:00", "America/New_York")).toBe(
			"2026-01-08T14:00:00.000Z",
		);
	});

	it("pads loosely-formatted times", () => {
		expect(wallTimeToUtcISO("2026-07-08", "9:5", "UTC")).toBe(
			"2026-07-08T09:05:00.000Z",
		);
	});
});

describe("utcToZonedParts", () => {
	it("round-trips a UTC instant back to zoned wall-clock parts", () => {
		const iso = wallTimeToUtcISO("2026-07-08", "16:00", "Asia/Manila");
		expect(utcToZonedParts(iso, "Asia/Manila")).toEqual({
			date: "2026-07-08",
			time: "16:00",
		});
		// The same instant reads differently in another zone.
		expect(utcToZonedParts(iso, "UTC")).toEqual({
			date: "2026-07-08",
			time: "08:00",
		});
	});
});

describe("timeZoneOffsetLabel", () => {
	it("formats GMT offsets", () => {
		expect(timeZoneOffsetLabel("Asia/Manila")).toBe("GMT+08:00");
		expect(timeZoneOffsetLabel("UTC")).toBe("GMT+00:00");
		expect(
			timeZoneOffsetLabel("America/New_York", new Date("2026-01-15T12:00:00Z")),
		).toBe("GMT-05:00");
	});
});

describe("diffMinutes", () => {
	it("computes signed minute spans", () => {
		expect(
			diffMinutes("2026-07-08T08:00:00.000Z", "2026-07-08T09:30:00.000Z"),
		).toBe(90);
		expect(
			diffMinutes("2026-07-08T09:30:00.000Z", "2026-07-08T08:00:00.000Z"),
		).toBe(-90);
	});
});

describe("formatTime12h", () => {
	it("renders 24h times in 12h form", () => {
		expect(formatTime12h("16:00")).toBe("4:00 PM");
		expect(formatTime12h("00:30")).toBe("12:30 AM");
		expect(formatTime12h("12:00")).toBe("12:00 PM");
		expect(formatTime12h("09:05")).toBe("9:05 AM");
	});
});

describe("parseTimeInput", () => {
	it("accepts common formats", () => {
		expect(parseTimeInput("4pm")).toBe("16:00");
		expect(parseTimeInput("4:30 PM")).toBe("16:30");
		expect(parseTimeInput("16:00")).toBe("16:00");
		expect(parseTimeInput("0930")).toBe("09:30");
		expect(parseTimeInput("9")).toBe("09:00");
		expect(parseTimeInput("12am")).toBe("00:00");
		expect(parseTimeInput("12pm")).toBe("12:00");
	});

	it("rejects nonsense", () => {
		expect(parseTimeInput("")).toBeNull();
		expect(parseTimeInput("25:00")).toBeNull();
		expect(parseTimeInput("banana")).toBeNull();
		expect(parseTimeInput("13pm")).toBeNull();
	});
});

describe("timeOptions", () => {
	it("produces a full day of slots at the given step", () => {
		const quarters = timeOptions(15);
		expect(quarters).toHaveLength(96);
		expect(quarters[0]).toBe("00:00");
		expect(quarters[1]).toBe("00:15");
		expect(quarters.at(-1)).toBe("23:45");
		expect(timeOptions(60)).toHaveLength(24);
	});
});
