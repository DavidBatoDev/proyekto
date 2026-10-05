import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { PeriodKind } from './time.types';
import {
  addDays,
  isoDow,
  isValidTimezone,
  localDate,
  localRangeToUtc,
  monthWindow,
  periodFor,
  retroactiveFloor,
  safeTimezone,
  weekWindow,
} from './time-periods';

/** start/end were produced by SQL time_period_for on dev (read-only SELECT), so the fixture is the oracle. */
interface ParityCase {
  kind: PeriodKind;
  timezone: string;
  week_start: number;
  anchor: string | null;
  at: string;
  start: string;
  end: string;
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '__fixtures__/period-parity.json'), 'utf8'),
) as ParityCase[];

describe('time-periods', () => {
  describe('parity with SQL time_period_for (__fixtures__/period-parity.json)', () => {
    it('has at least 60 cases covering every kind and both week starts', () => {
      expect(fixture.length).toBeGreaterThanOrEqual(60);
      expect(new Set(fixture.map((c) => c.kind))).toEqual(
        new Set(['weekly', 'biweekly', 'semi_monthly', 'monthly']),
      );
      expect(fixture.some((c) => c.week_start === 1)).toBe(true);
      expect(fixture.some((c) => c.week_start === 7)).toBe(true);
      expect(fixture.some((c) => c.anchor !== null)).toBe(true);
    });

    it.each(
      fixture.map(
        (c) =>
          [
            `${c.kind} ${c.timezone} ws=${c.week_start} anchor=${c.anchor} at=${c.at}`,
            c,
          ] as const,
      ),
    )('%s', (_label, c) => {
      expect(
        periodFor(
          {
            kind: c.kind,
            timezone: c.timezone,
            weekStart: c.week_start,
            anchor: c.anchor,
          },
          c.at,
        ),
      ).toEqual({
        start: c.start,
        end: c.end,
      });
    });
  });

  describe('periodFor', () => {
    const weekly = { kind: 'weekly' as const, timezone: 'UTC', weekStart: 1 };

    it('weekly honours week_start 1 and 7', () => {
      expect(periodFor(weekly, '2026-10-07T12:00:00Z')).toEqual({
        start: '2026-10-05',
        end: '2026-10-11',
      });
      expect(
        periodFor({ ...weekly, weekStart: 7 }, '2026-10-07T12:00:00Z'),
      ).toEqual({
        start: '2026-10-04',
        end: '2026-10-10',
      });
    });

    it('splits Asia/Manila and UTC on the 16:00Z boundary', () => {
      const at = new Date('2026-10-04T16:00:00Z');
      expect(periodFor({ ...weekly, timezone: 'Asia/Manila' }, at)).toEqual({
        start: '2026-10-05',
        end: '2026-10-11',
      });
      expect(periodFor(weekly, at)).toEqual({
        start: '2026-09-28',
        end: '2026-10-04',
      });
    });

    it('uses the local wall date across both 2026 New York DST transitions', () => {
      const ny = { ...weekly, timezone: 'America/New_York' };
      // 04:30Z on 03-09 is 00:30 EDT Monday (EST would still say Sunday).
      expect(periodFor(ny, '2026-03-09T04:30:00Z')).toEqual({
        start: '2026-03-09',
        end: '2026-03-15',
      });
      // 04:30Z on 11-02 is 23:30 EST Sunday (EDT would already say Monday).
      expect(periodFor(ny, '2026-11-02T04:30:00Z')).toEqual({
        start: '2026-10-26',
        end: '2026-11-01',
      });
    });

    it('biweekly defaults the anchor to 2024-01-01 + (week_start - 1) and floors before it', () => {
      const bi = { kind: 'biweekly' as const, timezone: 'UTC', weekStart: 1 };
      expect(periodFor(bi, '2024-01-01T00:00:00Z')).toEqual({
        start: '2024-01-01',
        end: '2024-01-14',
      });
      expect(periodFor(bi, '2023-12-31T23:59:59Z')).toEqual({
        start: '2023-12-18',
        end: '2023-12-31',
      });
      expect(
        periodFor({ ...bi, weekStart: 7 }, '2024-01-07T00:00:00Z'),
      ).toEqual({
        start: '2024-01-07',
        end: '2024-01-20',
      });
      expect(
        periodFor({ ...bi, anchor: '2026-09-28' }, '2026-10-12T00:00:00Z'),
      ).toEqual({
        start: '2026-10-12',
        end: '2026-10-25',
      });
    });

    it('semi-monthly splits on the 15th/16th, including February 2026 and 2028', () => {
      const semi = {
        kind: 'semi_monthly' as const,
        timezone: 'UTC',
        weekStart: 1,
      };
      expect(periodFor(semi, '2026-10-15T23:59:59Z')).toEqual({
        start: '2026-10-01',
        end: '2026-10-15',
      });
      expect(periodFor(semi, '2026-10-16T00:00:00Z')).toEqual({
        start: '2026-10-16',
        end: '2026-10-31',
      });
      expect(periodFor(semi, '2026-02-20T00:00:00Z')).toEqual({
        start: '2026-02-16',
        end: '2026-02-28',
      });
      expect(periodFor(semi, '2028-02-20T00:00:00Z')).toEqual({
        start: '2028-02-16',
        end: '2028-02-29',
      });
    });

    it('monthly covers the calendar month', () => {
      const monthly = {
        kind: 'monthly' as const,
        timezone: 'UTC',
        weekStart: 1,
      };
      expect(periodFor(monthly, '2026-02-10T00:00:00Z')).toEqual({
        start: '2026-02-01',
        end: '2026-02-28',
      });
      expect(periodFor(monthly, '2028-02-29T12:00:00Z')).toEqual({
        start: '2028-02-01',
        end: '2028-02-29',
      });
    });

    it('falls back to UTC for an unknown timezone, like SQL', () => {
      expect(
        periodFor({ ...weekly, timezone: 'Not/AZone' }, '2026-10-04T16:00:00Z'),
      ).toEqual({
        start: '2026-09-28',
        end: '2026-10-04',
      });
    });

    it('throws for an unknown kind, like SQL', () => {
      expect(() =>
        periodFor(
          { kind: 'fortnightly' as PeriodKind, timezone: 'UTC', weekStart: 1 },
          new Date(),
        ),
      ).toThrow(/unknown period kind/);
    });
  });

  describe('timezones and local dates', () => {
    it('validates timezones through Intl', () => {
      expect(isValidTimezone('Asia/Manila')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
      expect(isValidTimezone('Not/AZone')).toBe(false);
      expect(isValidTimezone('')).toBe(false);
    });

    it('safeTimezone maps invalid and missing to UTC', () => {
      expect(safeTimezone('America/New_York')).toBe('America/New_York');
      expect(safeTimezone('Not/AZone')).toBe('UTC');
      expect(safeTimezone(null)).toBe('UTC');
      expect(safeTimezone(undefined)).toBe('UTC');
    });

    it('localDate reads Dates, zoned strings, offset-less strings (UTC) and bare dates', () => {
      expect(localDate(new Date('2026-10-04T16:00:00Z'), 'Asia/Manila')).toBe(
        '2026-10-05',
      );
      expect(localDate('2026-10-04T15:59:59Z', 'Asia/Manila')).toBe(
        '2026-10-04',
      );
      expect(localDate('2026-10-05T00:30:00+08:00', 'UTC')).toBe('2026-10-04');
      expect(localDate('2026-10-04T16:00:00', 'Asia/Manila')).toBe(
        '2026-10-05',
      );
      expect(localDate('2026-10-05', 'America/New_York')).toBe('2026-10-04');
      expect(() => localDate('not a date', 'UTC')).toThrow(RangeError);
    });
  });

  describe('date helpers', () => {
    it('addDays crosses month, year and leap-day boundaries', () => {
      expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
      expect(addDays('2026-03-08', 0)).toBe('2026-03-08');
      expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    });

    it('isoDow is 1 for Monday and 7 for Sunday', () => {
      expect(isoDow('2026-10-05')).toBe(1);
      expect(isoDow('2026-10-04')).toBe(7);
      expect(isoDow('2028-02-29')).toBe(2);
    });

    it('weekWindow and monthWindow', () => {
      expect(weekWindow('2026-10-07', 1)).toEqual({
        start: '2026-10-05',
        end: '2026-10-11',
      });
      expect(weekWindow('2026-10-07', 7)).toEqual({
        start: '2026-10-04',
        end: '2026-10-10',
      });
      expect(weekWindow('2026-10-04', 7)).toEqual({
        start: '2026-10-04',
        end: '2026-10-10',
      });
      expect(monthWindow('2028-02-10')).toEqual({
        start: '2028-02-01',
        end: '2028-02-29',
      });
      expect(monthWindow('2026-12-31')).toEqual({
        start: '2026-12-01',
        end: '2026-12-31',
      });
    });
  });

  describe('localRangeToUtc', () => {
    it('is [start 00:00, end+1 00:00) local', () => {
      expect(
        localRangeToUtc({ start: '2026-10-05', end: '2026-10-11' }, 'UTC'),
      ).toEqual({
        fromIso: '2026-10-05T00:00:00.000Z',
        toExclusiveIso: '2026-10-12T00:00:00.000Z',
      });
      expect(
        localRangeToUtc(
          { start: '2026-10-05', end: '2026-10-11' },
          'Asia/Manila',
        ),
      ).toEqual({
        fromIso: '2026-10-04T16:00:00.000Z',
        toExclusiveIso: '2026-10-11T16:00:00.000Z',
      });
    });

    it('is DST-correct both ways (a 23 h and a 25 h day)', () => {
      expect(
        localRangeToUtc(
          { start: '2026-03-08', end: '2026-03-08' },
          'America/New_York',
        ),
      ).toEqual({
        fromIso: '2026-03-08T05:00:00.000Z',
        toExclusiveIso: '2026-03-09T04:00:00.000Z',
      });
      expect(
        localRangeToUtc(
          { start: '2026-11-01', end: '2026-11-01' },
          'America/New_York',
        ),
      ).toEqual({
        fromIso: '2026-11-01T04:00:00.000Z',
        toExclusiveIso: '2026-11-02T05:00:00.000Z',
      });
    });

    it('uses UTC for an unknown timezone', () => {
      expect(
        localRangeToUtc(
          { start: '2026-10-05', end: '2026-10-05' },
          'Not/AZone',
        ),
      ).toEqual({
        fromIso: '2026-10-05T00:00:00.000Z',
        toExclusiveIso: '2026-10-06T00:00:00.000Z',
      });
    });
  });

  describe('retroactiveFloor', () => {
    const now = new Date('2026-10-04T16:30:00Z');

    it('is null for no limit (null, 0, negative)', () => {
      expect(retroactiveFloor(now, 'UTC', null)).toBeNull();
      expect(retroactiveFloor(now, 'UTC', 0)).toBeNull();
      expect(retroactiveFloor(now, 'UTC', -3)).toBeNull();
    });

    it('is the local today minus N days in the policy timezone', () => {
      expect(retroactiveFloor(now, 'UTC', 7)).toBe('2026-09-27');
      expect(retroactiveFloor(now, 'Asia/Manila', 7)).toBe('2026-09-28');
      expect(retroactiveFloor(now, 'Asia/Manila', 30)).toBe('2026-09-05');
    });
  });
});
