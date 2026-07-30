import {
  billingPeriodForDate,
  billingPeriodsForRange,
  configForCadence,
  DEFAULT_PAY_PERIOD_CONFIG,
  lastBillablePeriod,
  MONTHLY_PAY_PERIOD_CONFIG,
  normalizePayPeriodConfig,
  PayPeriodConfig,
} from './billing-period';

describe('normalizePayPeriodConfig', () => {
  it('falls back to the PH semi-monthly default', () => {
    expect(normalizePayPeriodConfig(null)).toBe(DEFAULT_PAY_PERIOD_CONFIG);
    expect(normalizePayPeriodConfig({ cadence: 'monthly', periods: [] })).toBe(
      DEFAULT_PAY_PERIOD_CONFIG,
    );
  });

  it('keeps a usable config', () => {
    const custom: PayPeriodConfig = {
      cadence: 'monthly',
      periods: [
        {
          id: 'x',
          label: 'Whole month',
          start_day: 1,
          end_day: 'EOM',
          pay_day: 5,
          pay_month_offset: 1,
        },
      ],
    };
    expect(normalizePayPeriodConfig(custom)).toBe(custom);
  });
});

describe('billingPeriodsForRange — semi-monthly (team cut-offs)', () => {
  it('produces the 1–15 / 16–EOM windows with their pay dates', () => {
    const periods = billingPeriodsForRange(
      DEFAULT_PAY_PERIOD_CONFIG,
      '2026-08-01',
      '2026-09-30',
      { invoiceOffsetDays: 1, dueDays: 14 },
    );

    expect(periods.map((p) => [p.periodStart, p.periodEnd])).toEqual([
      ['2026-08-01', '2026-08-15'],
      ['2026-08-16', '2026-08-31'],
      ['2026-09-01', '2026-09-15'],
      ['2026-09-16', '2026-09-30'],
    ]);

    // 1–15 pays on the 22nd of the same month; 16–EOM pays on the 7th of the
    // next — the offsets the team actually runs.
    expect(periods[0].payDate).toBe('2026-08-22');
    expect(periods[1].payDate).toBe('2026-09-07');

    // Invoice one day after the period closes, due 14 days later.
    expect(periods[0].invoiceDate).toBe('2026-08-16');
    expect(periods[0].dueDate).toBe('2026-08-30');
  });

  it('rolls the pay date across a year boundary', () => {
    const periods = billingPeriodsForRange(
      DEFAULT_PAY_PERIOD_CONFIG,
      '2026-12-16',
      '2026-12-31',
    );
    expect(periods).toHaveLength(1);
    expect(periods[0].periodStart).toBe('2026-12-16');
    expect(periods[0].payDate).toBe('2027-01-07');
  });

  it('shortens February to its real length', () => {
    const periods = billingPeriodsForRange(
      DEFAULT_PAY_PERIOD_CONFIG,
      '2027-02-01',
      '2027-02-28',
    );
    expect(periods[1].periodEnd).toBe('2027-02-28');

    const leap = billingPeriodsForRange(
      DEFAULT_PAY_PERIOD_CONFIG,
      '2028-02-01',
      '2028-02-29',
    );
    expect(leap[1].periodEnd).toBe('2028-02-29');
  });

  // A contract starting mid-cut-off must still bill that partial period, and
  // the client must never be billed for days outside the service window.
  it('clamps the first and last period to the service window', () => {
    const periods = billingPeriodsForRange(
      DEFAULT_PAY_PERIOD_CONFIG,
      '2026-08-05',
      '2026-09-20',
      { invoiceOffsetDays: 0, dueDays: 15 },
    );
    expect(periods[0].periodStart).toBe('2026-08-05');
    expect(periods[0].periodEnd).toBe('2026-08-15');
    expect(periods[periods.length - 1].periodStart).toBe('2026-09-16');
    expect(periods[periods.length - 1].periodEnd).toBe('2026-09-20');
    // The clamped end reschedules the invoice and due dates too.
    expect(periods[periods.length - 1].invoiceDate).toBe('2026-09-20');
    expect(periods[periods.length - 1].dueDate).toBe('2026-10-05');
  });

  it('returns nothing when the window is inverted', () => {
    expect(
      billingPeriodsForRange(
        DEFAULT_PAY_PERIOD_CONFIG,
        '2026-09-01',
        '2026-08-01',
      ),
    ).toEqual([]);
  });
});

describe('billingPeriodsForRange — monthly', () => {
  it('bills one whole-month period per month', () => {
    const periods = billingPeriodsForRange(
      MONTHLY_PAY_PERIOD_CONFIG,
      '2026-08-01',
      '2027-07-31',
      { invoiceOffsetDays: 0, dueDays: 15 },
    );
    expect(periods).toHaveLength(12);
    expect(periods[0].periodStart).toBe('2026-08-01');
    expect(periods[0].periodEnd).toBe('2026-08-31');
    expect(periods[11].periodStart).toBe('2027-07-01');
    expect(periods[11].periodEnd).toBe('2027-07-31');
  });

  it('gives a 12-month semi-monthly contract 24 periods', () => {
    expect(
      billingPeriodsForRange(
        DEFAULT_PAY_PERIOD_CONFIG,
        '2026-08-01',
        '2027-07-31',
      ),
    ).toHaveLength(24);
  });
});

describe('billingPeriodForDate', () => {
  it.each([
    ['2026-08-01', '2026-08-01'],
    ['2026-08-15', '2026-08-01'],
    ['2026-08-16', '2026-08-16'],
    ['2026-08-31', '2026-08-16'],
  ])('%s falls in the period starting %s', (date, expectedStart) => {
    expect(
      billingPeriodForDate(DEFAULT_PAY_PERIOD_CONFIG, date)?.periodStart,
    ).toBe(expectedStart);
  });
});

describe('lastBillablePeriod', () => {
  const start = '2026-08-01';
  const end = '2027-07-31';

  it('never bills a period that is still open', () => {
    // Aug 10 sits inside 1–15, so only nothing before it has closed.
    expect(
      lastBillablePeriod(DEFAULT_PAY_PERIOD_CONFIG, start, end, '2026-08-10'),
    ).toBeNull();
  });

  it('bills the previous period once it has closed', () => {
    const period = lastBillablePeriod(
      DEFAULT_PAY_PERIOD_CONFIG,
      start,
      end,
      '2026-08-16',
    );
    expect(period?.periodStart).toBe('2026-08-01');
    expect(period?.periodEnd).toBe('2026-08-15');
  });

  it('waits for the invoice offset before billing a closed period', () => {
    const options = { invoiceOffsetDays: 3 };
    expect(
      lastBillablePeriod(
        DEFAULT_PAY_PERIOD_CONFIG,
        start,
        end,
        '2026-08-17',
        options,
      ),
    ).toBeNull();
    expect(
      lastBillablePeriod(
        DEFAULT_PAY_PERIOD_CONFIG,
        start,
        end,
        '2026-08-18',
        options,
      )?.periodEnd,
    ).toBe('2026-08-15');
  });

  it('picks the most recent closed period, not the first', () => {
    expect(
      lastBillablePeriod(DEFAULT_PAY_PERIOD_CONFIG, start, end, '2026-10-02')
        ?.periodEnd,
    ).toBe('2026-09-30');
  });
});

describe('advance (prepaid) billing', () => {
  const start = '2026-11-01';
  const end = '2027-10-31';
  const advance = (invoiceOffsetDays: number) => ({
    invoiceOffsetDays,
    dueDays: 15,
    billingTiming: 'advance' as const,
  });

  it('raises each invoice before the period it covers', () => {
    const periods = billingPeriodsForRange(
      MONTHLY_PAY_PERIOD_CONFIG,
      start,
      end,
      advance(7),
    );
    // December's invoice goes out on Nov 24, a week before December opens.
    const december = periods.find((p) => p.periodStart === '2026-12-01');
    expect(december?.invoiceDate).toBe('2026-11-24');
    expect(december?.dueDate).toBe('2026-12-09');
    for (const period of periods) {
      expect(period.invoiceDate < period.periodStart).toBe(true);
    }
  });

  it('leaves arrears anchored to the period end', () => {
    const [first] = billingPeriodsForRange(
      MONTHLY_PAY_PERIOD_CONFIG,
      start,
      end,
      { invoiceOffsetDays: 7, dueDays: 15 },
    );
    expect(first.periodEnd).toBe('2026-11-30');
    expect(first.invoiceDate).toBe('2026-12-07');
  });

  it('anchors a clamped first period to its clamped START, not its end', () => {
    // Mid-month start: the first period is truncated to Nov 10–30. Deriving
    // the invoice date from the clamped end would put a prepaid invoice AFTER
    // the period it covers.
    const [first] = billingPeriodsForRange(
      MONTHLY_PAY_PERIOD_CONFIG,
      '2026-11-10',
      '2027-10-31',
      advance(7),
    );
    expect(first.periodStart).toBe('2026-11-10');
    expect(first.periodEnd).toBe('2026-11-30');
    expect(first.invoiceDate).toBe('2026-11-03');
  });

  it('clamps a month-end lead into the previous month correctly', () => {
    // 31-day lead from Mar 1 lands on Jan 29 — addDays walks calendar days, so
    // February's length is handled without a clamp special case.
    const periods = billingPeriodsForRange(
      MONTHLY_PAY_PERIOD_CONFIG,
      '2027-01-01',
      '2027-12-31',
      advance(31),
    );
    const march = periods.find((p) => p.periodStart === '2027-03-01');
    expect(march?.invoiceDate).toBe('2027-01-29');
  });

  it('bills a period that has not started yet, once its invoice date arrives', () => {
    const options = advance(7);
    // Nov 24 is December's invoice date; December is entirely in the future.
    const period = lastBillablePeriod(
      MONTHLY_PAY_PERIOD_CONFIG,
      start,
      end,
      '2026-11-24',
      options,
    );
    expect(period?.periodStart).toBe('2026-12-01');
    expect(period?.periodEnd).toBe('2026-12-31');
  });

  it('still refuses to bill before the lead time has arrived', () => {
    // The very first invoice (for November) goes out Oct 25.
    const options = advance(7);
    expect(
      lastBillablePeriod(
        MONTHLY_PAY_PERIOD_CONFIG,
        start,
        end,
        '2026-10-24',
        options,
      ),
    ).toBeNull();
    expect(
      lastBillablePeriod(
        MONTHLY_PAY_PERIOD_CONFIG,
        start,
        end,
        '2026-10-25',
        options,
      )?.periodStart,
    ).toBe('2026-11-01');
  });

  it('picks the latest period whose invoice date has arrived, and no further', () => {
    // February's invoice date is Jan 25. The day before, January is still the
    // furthest the scheduler may go — advance billing runs one period ahead,
    // not arbitrarily far ahead.
    const at = (today: string) =>
      lastBillablePeriod(
        MONTHLY_PAY_PERIOD_CONFIG,
        start,
        end,
        today,
        advance(7),
      )?.periodStart;
    expect(at('2027-01-24')).toBe('2027-01-01');
    expect(at('2027-01-25')).toBe('2027-02-01');
  });
});

describe('configForCadence', () => {
  const teamConfig: PayPeriodConfig = {
    cadence: 'monthly',
    periods: [
      {
        id: 'custom',
        label: 'Custom',
        start_day: 6,
        end_day: 20,
        pay_day: 25,
        pay_month_offset: 0,
      },
    ],
  };

  it('ignores the team cut-offs for monthly billing', () => {
    expect(configForCadence('monthly', teamConfig)).toBe(
      MONTHLY_PAY_PERIOD_CONFIG,
    );
  });

  // This is the whole point of period_source='team_config': billed hours have
  // to line up with the cut-offs the team approves and pays out against.
  it('defers to the team cut-offs for semi-monthly billing', () => {
    expect(configForCadence('semi_monthly', teamConfig)).toBe(teamConfig);
  });

  it('falls back to the default when the team has no config', () => {
    expect(configForCadence('semi_monthly', null)).toBe(
      DEFAULT_PAY_PERIOD_CONFIG,
    );
  });
});
