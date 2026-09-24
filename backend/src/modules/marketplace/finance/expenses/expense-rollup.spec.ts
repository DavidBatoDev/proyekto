import {
  addMonthsClamped,
  expenseOccurrences,
  expenseOverlapsWindow,
  type RollupExpense,
  summarizeExpenses,
} from './expense-rollup';

function expense(partial: Partial<RollupExpense> = {}): RollupExpense {
  return {
    category: 'software_subscription',
    amount: 10,
    currency: 'USD',
    incurred_on: '2026-01-15',
    recurrence: 'none',
    recurrence_ends_on: null,
    voided_at: null,
    ...partial,
  };
}

describe('addMonthsClamped', () => {
  it('keeps the original day and clamps to month length', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('lands a Feb 29 yearly expense on Feb 28 in non-leap years', () => {
    expect(addMonthsClamped('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonthsClamped('2028-02-29', 48)).toBe('2032-02-29');
  });
});

describe('expenseOccurrences', () => {
  const today = '2026-09-24';

  it('one-off counts once when inside the window', () => {
    expect(expenseOccurrences(expense(), {}, today)).toEqual(['2026-01-15']);
    expect(
      expenseOccurrences(expense(), { from: '2026-02-01' }, today),
    ).toEqual([]);
    expect(expenseOccurrences(expense(), { to: '2026-01-14' }, today)).toEqual(
      [],
    );
  });

  it('one-off dated in the future still counts (entered deliberately)', () => {
    expect(
      expenseOccurrences(expense({ incurred_on: '2026-12-01' }), {}, today),
    ).toEqual(['2026-12-01']);
  });

  it('monthly expands up to today with no end date', () => {
    const dates = expenseOccurrences(
      expense({ recurrence: 'monthly' }),
      {},
      today,
    );
    expect(dates).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
      '2026-05-15',
      '2026-06-15',
      '2026-07-15',
      '2026-08-15',
      '2026-09-15',
    ]);
  });

  it('monthly stops at recurrence_ends_on, window end, and today (min)', () => {
    const monthly = expense({
      recurrence: 'monthly',
      recurrence_ends_on: '2026-06-30',
    });
    expect(expenseOccurrences(monthly, {}, today)).toHaveLength(6);
    expect(expenseOccurrences(monthly, { to: '2026-03-31' }, today)).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
    expect(expenseOccurrences(monthly, {}, '2026-02-14')).toEqual([
      '2026-01-15',
    ]);
  });

  it('monthly respects the window start', () => {
    expect(
      expenseOccurrences(
        expense({ recurrence: 'monthly' }),
        { from: '2026-08-01', to: '2026-08-31' },
        today,
      ),
    ).toEqual(['2026-08-15']);
  });

  it('a recurring expense starting after today yields nothing yet', () => {
    expect(
      expenseOccurrences(
        expense({ recurrence: 'monthly', incurred_on: '2026-10-01' }),
        {},
        today,
      ),
    ).toEqual([]);
  });

  it('yearly expands once per year', () => {
    expect(
      expenseOccurrences(
        expense({ recurrence: 'yearly', incurred_on: '2023-03-01' }),
        {},
        today,
      ),
    ).toEqual(['2023-03-01', '2024-03-01', '2025-03-01', '2026-03-01']);
  });
});

describe('expenseOverlapsWindow', () => {
  it('lists a recurring row whose run overlaps the window', () => {
    const monthly = expense({ recurrence: 'monthly' });
    expect(expenseOverlapsWindow(monthly, { from: '2026-08-01' })).toBe(true);
    expect(
      expenseOverlapsWindow(
        { ...monthly, recurrence_ends_on: '2026-03-31' },
        { from: '2026-08-01' },
      ),
    ).toBe(false);
    expect(expenseOverlapsWindow(monthly, { to: '2026-01-01' })).toBe(false);
  });

  it('lists a one-off only inside the window', () => {
    expect(expenseOverlapsWindow(expense(), {})).toBe(true);
    expect(expenseOverlapsWindow(expense(), { from: '2026-02-01' })).toBe(
      false,
    );
  });
});

describe('summarizeExpenses', () => {
  const today = '2026-09-24';

  it('rolls expenses and payouts per currency without mixing', () => {
    const summary = summarizeExpenses(
      [
        expense({ amount: 10, recurrence: 'monthly' }), // 9 x 10 USD
        expense({ category: 'overhead', amount: 250.5 }),
        expense({ category: 'contractor', amount: 1000, currency: 'PHP' }),
        expense({ amount: 999, voided_at: '2026-02-01T00:00:00Z' }),
      ],
      [
        {
          currency: 'USD',
          total_amount: '400.25',
          paid_at: '2026-05-01T08:00:00Z',
        },
        { currency: 'PHP', total_amount: 5000, paid_at: '2026-06-01' },
      ],
      {},
      today,
    );

    expect(summary).toEqual([
      {
        currency: 'PHP',
        expenses_total: 1000,
        payouts_total: 5000,
        total: 6000,
        by_category: {
          salary: 5000,
          contractor: 1000,
          software_subscription: 0,
          overhead: 0,
          tax_fees: 0,
          other: 0,
        },
      },
      {
        currency: 'USD',
        expenses_total: 340.5,
        payouts_total: 400.25,
        total: 740.75,
        by_category: {
          salary: 400.25,
          contractor: 0,
          software_subscription: 90,
          overhead: 250.5,
          tax_fees: 0,
          other: 0,
        },
      },
    ]);
  });

  it('windows payouts by their paid date', () => {
    const summary = summarizeExpenses(
      [],
      [
        { currency: 'USD', total_amount: 100, paid_at: '2026-04-30T23:00:00Z' },
        { currency: 'USD', total_amount: 50, paid_at: '2026-05-10T00:00:00Z' },
      ],
      { from: '2026-05-01', to: '2026-05-31' },
      today,
    );
    expect(summary[0].payouts_total).toBe(50);
    expect(summary[0].expenses_total).toBe(0);
  });

  it('returns an empty array when nothing falls in the window', () => {
    expect(
      summarizeExpenses([expense()], [], { from: '2027-01-01' }, today),
    ).toEqual([]);
  });
});
