import { describe, expect, it } from "vitest";
import {
	buildRRule,
	expandOccurrences,
	parseRRule,
	presetsFor,
	type RecurrenceRule,
	rruleToPresetId,
	rruleWeekdayOf,
	summarizeRRule,
} from "./recurrence";

// July 7, 2026 is a Tuesday (see the calendar in the task screenshots).
// Local-component constructors keep getDate/getMonth/getDay stable across the
// machine's timezone; UTC constructors do the same for rrule expansion.
const TUE_LOCAL = new Date(2026, 6, 7, 4, 0);
const TUE_UTC = new Date(Date.UTC(2026, 6, 7, 4, 0));

describe("rruleWeekdayOf", () => {
	it("maps a JS date to rrule's Mon=0..Sun=6 convention", () => {
		expect(rruleWeekdayOf(TUE_LOCAL)).toBe(1); // Tuesday
		expect(rruleWeekdayOf(new Date(2026, 6, 5))).toBe(6); // Sunday
		expect(rruleWeekdayOf(new Date(2026, 6, 6))).toBe(0); // Monday
	});
});

describe("buildRRule", () => {
	it("serializes a weekly-on-Tuesday rule as an RFC-5545 body without the tag", () => {
		expect(
			buildRRule({
				freq: "weekly",
				interval: 1,
				byweekday: [1],
				ends: { type: "never" },
			}),
		).toBe("FREQ=WEEKLY;INTERVAL=1;BYDAY=TU");
	});

	it("encodes an 'after N' end as COUNT", () => {
		expect(
			buildRRule({
				freq: "daily",
				interval: 2,
				ends: { type: "after", count: 5 },
			}),
		).toBe("FREQ=DAILY;INTERVAL=2;COUNT=5");
	});

	it("encodes an 'on <date>' end as a UTC UNTIL", () => {
		const body = buildRRule({
			freq: "weekly",
			interval: 1,
			byweekday: [1],
			ends: { type: "on", date: "2026-12-31" },
		});
		expect(body).toContain("UNTIL=20261231T235959Z");
	});

	it("clamps interval to at least 1", () => {
		expect(
			buildRRule({ freq: "daily", interval: 0, ends: { type: "never" } }),
		).toBe("FREQ=DAILY;INTERVAL=1");
	});
});

describe("parseRRule", () => {
	it("round-trips a built rule back to structure", () => {
		const rule: RecurrenceRule = {
			freq: "weekly",
			interval: 2,
			byweekday: [0, 2, 4],
			ends: { type: "after", count: 10 },
		};
		const parsed = parseRRule(buildRRule(rule));
		expect(parsed.freq).toBe("weekly");
		expect(parsed.interval).toBe(2);
		expect(parsed.byweekday).toEqual([0, 2, 4]);
		expect(parsed.ends).toEqual({ type: "after", count: 10 });
	});

	it("tolerates a leading RRULE: tag and reads UNTIL back as a date", () => {
		const parsed = parseRRule(
			"RRULE:FREQ=MONTHLY;BYMONTHDAY=7;UNTIL=20261231T235959Z",
		);
		expect(parsed.freq).toBe("monthly");
		expect(parsed.bymonthday).toEqual([7]);
		expect(parsed.ends).toEqual({ type: "on", date: "2026-12-31" });
	});
});

describe("presetsFor", () => {
	it("labels weekly/monthly/yearly presets against the start date", () => {
		const presets = presetsFor(TUE_LOCAL);
		const byId = Object.fromEntries(presets.map((p) => [p.id, p]));
		expect(byId.none.rrule).toBeNull();
		expect(byId.weekly.label).toBe("Weekly on Tuesday");
		expect(byId.weekly.rrule).toBe("FREQ=WEEKLY;INTERVAL=1;BYDAY=TU");
		expect(byId.monthly.label).toBe("Monthly on day 7");
		expect(byId.yearly.label).toBe("Annually on July 7");
		expect(byId.weekdays.rrule).toBe(
			"FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR",
		);
		expect(byId.custom.rrule).toBeNull();
	});
});

describe("rruleToPresetId", () => {
	it("recognizes a stored rule as its matching preset", () => {
		expect(rruleToPresetId("FREQ=WEEKLY;INTERVAL=1;BYDAY=TU", TUE_LOCAL)).toBe(
			"weekly",
		);
		expect(rruleToPresetId(null, TUE_LOCAL)).toBe("none");
	});

	it("falls back to custom for non-1 intervals or bounded rules", () => {
		expect(rruleToPresetId("FREQ=WEEKLY;INTERVAL=3;BYDAY=TU", TUE_LOCAL)).toBe(
			"custom",
		);
		expect(
			rruleToPresetId("FREQ=WEEKLY;INTERVAL=1;BYDAY=TU;COUNT=4", TUE_LOCAL),
		).toBe("custom");
	});
});

describe("summarizeRRule", () => {
	it("produces a capitalized human summary", () => {
		expect(summarizeRRule("FREQ=WEEKLY;INTERVAL=1;BYDAY=TU")).toBe(
			"Every week on Tuesday",
		);
	});
});

describe("expandOccurrences", () => {
	it("returns the Tuesdays within a month window", () => {
		const occ = expandOccurrences(
			"FREQ=WEEKLY;INTERVAL=1;BYDAY=TU",
			TUE_UTC,
			new Date(Date.UTC(2026, 6, 1)),
			new Date(Date.UTC(2026, 7, 1)),
		);
		expect(occ).toHaveLength(4); // Jul 7, 14, 21, 28
		for (const d of occ) expect(d.getUTCDay()).toBe(2); // Tuesday
	});

	it("respects a COUNT bound", () => {
		const occ = expandOccurrences(
			"FREQ=DAILY;INTERVAL=1;COUNT=3",
			TUE_UTC,
			new Date(Date.UTC(2026, 6, 1)),
			new Date(Date.UTC(2026, 11, 31)),
		);
		expect(occ).toHaveLength(3);
	});
});
