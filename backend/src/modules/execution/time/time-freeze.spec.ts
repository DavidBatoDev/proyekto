import type { FreezeEntryValue } from './time.types';
import {
  amountFor,
  capInOrder,
  roundSeconds,
  sumByCurrency,
} from './time-freeze';

describe('time-freeze', () => {
  describe('roundSeconds', () => {
    it('0 (or less) leaves seconds unchanged', () => {
      expect(roundSeconds(1234, 0)).toBe(1234);
      expect(roundSeconds(1234, -5)).toBe(1234);
    });

    it('rounds to the nearest increment', () => {
      expect(roundSeconds(7 * 60, 15)).toBe(0);
      expect(roundSeconds(8 * 60, 15)).toBe(15 * 60);
      expect(roundSeconds(22 * 60 + 29, 15)).toBe(15 * 60);
      expect(roundSeconds(23 * 60, 15)).toBe(30 * 60);
      expect(roundSeconds(3600 + 2 * 60, 5)).toBe(3600);
      expect(roundSeconds(3600 + 3 * 60, 6)).toBe(3600 + 6 * 60);
    });

    it('ties go up (D14)', () => {
      expect(roundSeconds(150, 5)).toBe(300);
      expect(roundSeconds(7 * 60 + 30, 15)).toBe(15 * 60);
      expect(roundSeconds(15 * 60, 30)).toBe(30 * 60);
      expect(roundSeconds(149, 5)).toBe(0);
    });

    it('is never negative', () => {
      expect(roundSeconds(-100, 0)).toBe(0);
      expect(roundSeconds(-100, 15)).toBe(0);
    });
  });

  describe('capInOrder', () => {
    const entries = [
      { id: 'c', started_at: '2026-10-07T09:00:00Z', seconds: 3 * 3600 },
      { id: 'a', started_at: '2026-10-05T09:00:00Z', seconds: 4 * 3600 },
      { id: 'b', started_at: '2026-10-06T09:00:00Z', seconds: 4 * 3600 },
    ];

    it('no cap: everything is payable, nothing over', () => {
      const out = capInOrder(entries, null, 0, false);
      expect(out.get('a')).toEqual({ payable: 4 * 3600, over: 0 });
      expect(out.get('b')).toEqual({ payable: 4 * 3600, over: 0 });
      expect(out.get('c')).toEqual({ payable: 3 * 3600, over: 0 });
    });

    it('allocates the remaining allowance in started_at order', () => {
      const out = capInOrder(entries, 10 * 3600, 0, false);
      expect(out.get('a')).toEqual({ payable: 4 * 3600, over: 0 });
      expect(out.get('b')).toEqual({ payable: 4 * 3600, over: 0 });
      expect(out.get('c')).toEqual({ payable: 2 * 3600, over: 3600 });
      expect([...out.keys()]).toEqual(['a', 'b', 'c']);
    });

    it('subtracts time already approved in the window', () => {
      const out = capInOrder(entries, 10 * 3600, 5 * 3600, false);
      expect(out.get('a')).toEqual({ payable: 4 * 3600, over: 0 });
      expect(out.get('b')).toEqual({ payable: 3600, over: 3 * 3600 });
      expect(out.get('c')).toEqual({ payable: 0, over: 3 * 3600 });
    });

    it('an exhausted window pays nothing', () => {
      const out = capInOrder(entries, 10 * 3600, 12 * 3600, false);
      for (const id of ['a', 'b', 'c']) expect(out.get(id)!.payable).toBe(0);
    });

    it('ties on started_at break by id', () => {
      const tied = [
        { id: 'y', started_at: '2026-10-05T09:00:00Z', seconds: 3600 },
        { id: 'x', started_at: '2026-10-05T09:00:00Z', seconds: 3600 },
      ];
      const out = capInOrder(tied, 3600, 0, false);
      expect(out.get('x')).toEqual({ payable: 3600, over: 0 });
      expect(out.get('y')).toEqual({ payable: 0, over: 3600 });
    });

    it('approve_overtime pays the rounded seconds but still reports the overage', () => {
      const out = capInOrder(entries, 10 * 3600, 0, true);
      expect(out.get('a')).toEqual({ payable: 4 * 3600, over: 0 });
      expect(out.get('b')).toEqual({ payable: 4 * 3600, over: 0 });
      expect(out.get('c')).toEqual({ payable: 3 * 3600, over: 3600 });
    });

    it('does not mutate its input', () => {
      const copy = entries.map((e) => ({ ...e }));
      capInOrder(entries, 3600, 0, false);
      expect(entries).toEqual(copy);
    });
  });

  describe('amountFor', () => {
    it('is round(payable/3600 × rate, 2) for hourly', () => {
      expect(amountFor(5400, 500, 'hourly', true)).toBe(750);
      expect(amountFor(1000, 10, 'hourly', true)).toBe(2.78);
      expect(amountFor(0, 500, 'hourly', true)).toBe(0);
      expect(amountFor(3600, 12.345, 'hourly', true)).toBe(12.35);
    });

    it('rounds half up without float drift', () => {
      // 18 s × 201 / 3600 = 1.005 exactly
      expect(amountFor(18, 201, 'hourly', true)).toBe(1.01);
    });

    it('is null for fixed and for a client-only governing engagement', () => {
      expect(amountFor(5400, 500, 'fixed', true)).toBeNull();
      expect(amountFor(5400, 500, 'hourly', false)).toBeNull();
    });
  });

  describe('sumByCurrency', () => {
    const v = (
      payable: number,
      rate: number,
      currency: string,
      amount: number | null,
    ): FreezeEntryValue => ({
      payable_seconds: payable,
      rate_snapshot: rate,
      rate_type_snapshot: amount === null ? 'fixed' : 'hourly',
      currency_snapshot: currency,
      amount_snapshot: amount,
    });

    it('totals per currency and skips entries without an amount', () => {
      expect(
        sumByCurrency([
          v(5400, 500, 'PHP', 750),
          v(3600, 500, 'PHP', 500),
          v(3600, 20, 'USD', 20),
          v(3600, 900, 'USD', null),
        ]),
      ).toEqual({ PHP: 1250, USD: 20 });
    });

    it('rounds once on the sum, not per entry (L63)', () => {
      // three entries of 1000 s at 10/h: each 2.777…, per-entry rounding would give 8.34
      expect(
        sumByCurrency([
          v(1000, 10, 'USD', 2.78),
          v(1000, 10, 'USD', 2.78),
          v(1000, 10, 'USD', 2.78),
        ]),
      ).toEqual({
        USD: 8.33,
      });
    });

    it('is empty for no amountable entries', () => {
      expect(sumByCurrency([])).toEqual({});
      expect(sumByCurrency([v(3600, 100, 'PHP', null)])).toEqual({});
    });
  });
});
