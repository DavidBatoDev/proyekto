import { expandOccurrences, parseUntilCount, wallFromUtc } from './recurrence';

describe('recurrence.expandOccurrences', () => {
  it('expands a weekly rule at a fixed wall-clock in the series timezone', () => {
    // Tuesdays 4:00pm in Manila (UTC+8, no DST) → 08:00Z.
    const occ = expandOccurrences(
      'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
      '2026-07-07T16:00:00',
      'Asia/Manila',
      { horizonDays: 21 },
    );
    expect(occ.length).toBe(4); // Jul 7, 14, 21, 28 within a 21-day horizon
    expect(occ[0].scheduledAt).toBe('2026-07-07T08:00:00.000Z');
    expect(occ[1].scheduledAt).toBe('2026-07-14T08:00:00.000Z');
    // recurrenceId equals scheduledAt at materialization.
    expect(occ[0].recurrenceId).toBe(occ[0].scheduledAt);
  });

  it('keeps a fixed local time across a DST transition', () => {
    // Wednesdays 9:00am New York. DST ends 2026-11-01, so late-Oct occurrences
    // are UTC-4 (13:00Z) and November ones are UTC-5 (14:00Z).
    const occ = expandOccurrences(
      'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
      '2026-10-28T09:00:00',
      'America/New_York',
      { horizonDays: 14 },
    );
    expect(occ[0].scheduledAt).toBe('2026-10-28T13:00:00.000Z'); // EDT (UTC-4)
    expect(occ[1].scheduledAt).toBe('2026-11-04T14:00:00.000Z'); // EST (UTC-5)
  });

  it('respects a COUNT bound', () => {
    const occ = expandOccurrences(
      'FREQ=DAILY;INTERVAL=1;COUNT=3',
      '2026-07-07T10:00:00',
      'UTC',
      { horizonDays: 365 },
    );
    expect(occ.length).toBe(3);
  });

  it('caps runaway expansion', () => {
    const occ = expandOccurrences(
      'FREQ=DAILY;INTERVAL=1',
      '2026-07-07T10:00:00',
      'UTC',
      { horizonDays: 3650, max: 50 },
    );
    expect(occ.length).toBe(50);
  });

  it('can start expansion partway through (horizon top-up)', () => {
    const occ = expandOccurrences(
      'FREQ=DAILY;INTERVAL=1;COUNT=5',
      '2026-07-07T10:00:00',
      'UTC',
      { fromWall: '2026-07-09T00:00:00' },
    );
    // Jul 9, 10, 11 (7 and 8 skipped by fromWall).
    expect(occ.length).toBe(3);
    expect(occ[0].scheduledAt).toBe('2026-07-09T10:00:00.000Z');
  });
});

describe('recurrence.wallFromUtc', () => {
  it('renders a UTC instant as wall-clock in a zone', () => {
    expect(wallFromUtc('2026-07-07T08:00:00.000Z', 'Asia/Manila')).toBe(
      '2026-07-07T16:00:00',
    );
  });
});

describe('recurrence.parseUntilCount', () => {
  it('reads count and until mirrors', () => {
    expect(parseUntilCount('FREQ=DAILY;COUNT=4')).toEqual({
      until: null,
      count: 4,
    });
    const { count, until } = parseUntilCount(
      'FREQ=WEEKLY;UNTIL=20261231T235959Z',
    );
    expect(count).toBeNull();
    expect(until).toContain('2026-12-31');
  });
});
