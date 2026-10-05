import {
  pickRate,
  ratesInForceOn,
  type EngagementTimeRateRow,
} from './engagements.service';

/**
 * The rate rows the signing RPC leaves behind for a recorded agreement signed
 * in March with paper amendments effective June and September: each version
 * closes the one before it the day before it starts.
 */
const chain = [
  {
    source_contract_id: 'v1',
    amount: 1000,
    effective_from: '2026-03-01',
    effective_until: '2026-05-31',
  },
  {
    source_contract_id: 'v2',
    amount: 1200,
    effective_from: '2026-06-01',
    effective_until: '2026-08-31',
  },
  {
    source_contract_id: 'v3',
    amount: 1500,
    effective_from: '2026-09-01',
    effective_until: null,
  },
];

describe('past-period reports use the terms in force at the time', () => {
  it.each([
    ['2026-03-15', 'v1', 1000],
    ['2026-05-31', 'v1', 1000],
    ['2026-06-01', 'v2', 1200],
    ['2026-08-20', 'v2', 1200],
    ['2026-09-01', 'v3', 1500],
    ['2026-12-31', 'v3', 1500],
  ])('on %s it is %s at %d', (date, version, amount) => {
    const inForce = ratesInForceOn(chain, date);
    expect(inForce).toHaveLength(1);
    expect(inForce[0]).toMatchObject({
      source_contract_id: version,
      amount,
    });
  });

  it('has nothing in force before the agreement', () => {
    expect(ratesInForceOn(chain, '2026-02-28')).toEqual([]);
  });

  it('prices a quarter across versions month by month', () => {
    const months = ['2026-05-15', '2026-06-15', '2026-09-15'];
    expect(months.map((day) => ratesInForceOn(chain, day)[0].amount)).toEqual([
      1000, 1200, 1500,
    ]);
  });
});

function rate(
  row: Partial<EngagementTimeRateRow> & { id: string },
): EngagementTimeRateRow {
  return {
    engagement_id: 'eng-1',
    source_contract_id: 'v1',
    worker_user_id: null,
    rate_kind: 'cost',
    unit: 'hour',
    work_type: null,
    amount: 40,
    currency: 'USD',
    effective_from: '2026-03-01',
    effective_until: null,
    ...row,
  };
}

describe('pickRate: the one rate that prices an entry (E43)', () => {
  it('prefers the matching work_type over a work_type IS NULL row', () => {
    const rows = [
      rate({ id: 'generic', amount: 40 }),
      rate({ id: 'training', work_type: 'training', amount: 25 }),
      rate({ id: 'real', work_type: 'real_work', amount: 45 }),
    ];
    expect(pickRate(rows, '2026-04-01', 'training')?.id).toBe('training');
    expect(pickRate(rows, '2026-04-01', 'real_work')?.id).toBe('real');
  });

  it('falls back to the work_type IS NULL row', () => {
    const rows = [
      rate({ id: 'training', work_type: 'training', amount: 25 }),
      rate({ id: 'generic', amount: 40 }),
    ];
    expect(pickRate(rows, '2026-04-01', 'real_work')?.id).toBe('generic');
  });

  it('never applies a row for the other work type', () => {
    const rows = [rate({ id: 'training', work_type: 'training' })];
    expect(pickRate(rows, '2026-04-01', 'real_work')).toBeNull();
  });

  it('prefers the matching work_type even when the NULL row is newer', () => {
    const rows = [
      rate({
        id: 'training',
        work_type: 'training',
        effective_from: '2026-01-01',
      }),
      rate({ id: 'generic', effective_from: '2026-03-01' }),
    ];
    expect(pickRate(rows, '2026-04-01', 'training')?.id).toBe('training');
  });

  it('takes the latest effective_from among overlapping rows of one tier', () => {
    const rows = [
      rate({ id: 'older', effective_from: '2026-01-01' }),
      rate({ id: 'newer', effective_from: '2026-03-01' }),
    ];
    expect(pickRate(rows, '2026-04-01', 'real_work')?.id).toBe('newer');
    // Before the newer row starts, only the older one is in force.
    expect(pickRate(rows, '2026-02-01', 'real_work')?.id).toBe('older');
  });

  it('breaks an effective_from tie by id', () => {
    const rows = [rate({ id: 'rate-b' }), rate({ id: 'rate-a' })];
    expect(pickRate(rows, '2026-04-01', 'real_work')?.id).toBe('rate-a');
  });

  it('prices time with the hourly row of a hybrid agreement, not the retainer', () => {
    const rows = [
      rate({ id: 'retainer', unit: 'month', amount: 3000 }),
      rate({ id: 'hourly', unit: 'hour', amount: 50 }),
    ];
    expect(pickRate(rows, '2026-04-01', 'real_work')?.id).toBe('hourly');
  });

  it.each(['month', 'fixed'])(
    'returns a %s row as-is when it is the only one',
    (unit) => {
      const rows = [rate({ id: 'flat', unit, amount: 3000 })];
      expect(pickRate(rows, '2026-04-01', 'real_work')).toMatchObject({
        id: 'flat',
        unit,
        amount: 3000,
      });
    },
  );

  it('applies the in-force rule itself, across amendments', () => {
    const rows = [
      rate({
        id: 'v1',
        amount: 1000,
        effective_from: '2026-03-01',
        effective_until: '2026-05-31',
      }),
      rate({
        id: 'v2',
        source_contract_id: 'v2',
        amount: 1200,
        effective_from: '2026-06-01',
      }),
    ];
    expect(pickRate(rows, '2026-05-31', 'real_work')?.amount).toBe(1000);
    expect(pickRate(rows, '2026-06-01', 'real_work')?.amount).toBe(1200);
    expect(pickRate(rows, '2026-02-28', 'real_work')).toBeNull();
  });

  it('returns null for no rows', () => {
    expect(pickRate([], '2026-04-01', 'training')).toBeNull();
  });
});
